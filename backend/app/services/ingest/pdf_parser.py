"""PDF → blocks (spec §4.3, Phase 5).

A PDF is a *rendering* format, not a text format: it stores positioned glyph
runs, not paragraphs. Everything here is the work of reconstructing prose
from geometry, and "reads acceptably" is the bar rather than perfection.

Three problems get solved, in order:

1. **No text layer.** A scanned book is images of pages. There is nothing to
   extract, and we say so plainly instead of importing an empty book.
2. **Running heads and folios.** The book's title and page number repeat on
   almost every page. Left in, they interrupt the prose mid-sentence every
   275 words, so they're detected by *position plus repetition* and dropped.
3. **Lines, not paragraphs.** A PDF stores hard line breaks. They're rejoined
   into paragraphs, undoing end-of-line hyphenation on the way.

Unlike EPUB, a PDF's pages are real, so blocks carry their true page number
and the book is flagged `uses_native_pages` — the reader then shows the same
page numbers printed in the document.
"""

import re
from collections import Counter
from pathlib import Path

import fitz  # PyMuPDF

from app.services.ingest.base import ParseError, ParsedBlock, ParsedBook, ParsedBookMeta, ParsedChapter

# A block must sit within this fraction of the page's top or bottom edge to
# be considered running chrome. Body text rarely starts that close to the cut.
_CHROME_BAND = 0.12

# Chrome has to repeat on at least this share of pages (and this many pages
# absolutely) before it's dropped — a phrase that appears on three pages of a
# four-page document is more likely to be prose than a running head.
_CHROME_PAGE_RATIO = 0.5
_CHROME_MIN_PAGES = 3

# A block whose largest glyph is this much bigger than the document's body
# size, and which is short enough to be a title rather than a sentence, is
# treated as a heading when the PDF has no outline of its own.
_HEADING_SIZE_RATIO = 1.18
_HEADING_MAX_WORDS = 14

_ROMAN_OR_DIGITS = re.compile(r"^[\divxlcdmIVXLCDM\s.\-–—|]+$")
# Two words joined across a line break by a hyphen: "recon-\nstruct".
_LINE_HYPHEN = re.compile(r"(\w)-\s*$")


def _normalise_for_repeat(text: str) -> str:
    """Page numbers differ on every page, so digits are collapsed before
    comparing — otherwise "Chapter 4 · 87" never matches "Chapter 4 · 88"."""
    return re.sub(r"\d+", "#", text.strip().lower())


def _is_folio(text: str) -> bool:
    """A bare page number, in digits or roman numerals."""
    stripped = text.strip()
    return bool(stripped) and len(stripped) <= 12 and bool(_ROMAN_OR_DIGITS.match(stripped))


def _open(path: Path) -> fitz.Document:
    try:
        doc = fitz.open(str(path))
    except Exception as exc:
        raise ParseError("This PDF could not be opened — the file may be corrupt.") from exc

    if doc.is_encrypted:
        # An empty password unlocks most "protected" PDFs; a real one is DRM
        # we neither can nor should strip.
        if not doc.authenticate(""):
            doc.close()
            raise ParseError("This PDF is password-protected, so its text can't be read.")

    if doc.page_count == 0:
        doc.close()
        raise ParseError("This PDF has no pages.")
    return doc


def _page_blocks(page: fitz.Page) -> list[dict]:
    """One entry per text block: its text lines, vertical position as a
    fraction of page height, and its largest font size."""
    try:
        raw = page.get_text("dict")
    except Exception:
        return []

    height = page.rect.height or 1.0
    out: list[dict] = []

    for block in raw.get("blocks", []):
        if block.get("type") != 0:  # 0 = text, 1 = image
            continue

        lines: list[str] = []
        max_size = 0.0
        for line in block.get("lines", []):
            spans = line.get("spans", [])
            text = "".join(span.get("text", "") for span in spans)
            if text.strip():
                lines.append(text)
            for span in spans:
                max_size = max(max_size, float(span.get("size", 0.0)))

        if not lines:
            continue

        y0 = float(block.get("bbox", (0, 0, 0, 0))[1])
        out.append(
            {
                "lines": lines,
                "text": " ".join(" ".join(lines).split()),
                "y_frac": y0 / height,
                "size": max_size,
            }
        )

    return out


def _find_chrome(pages: list[list[dict]]) -> set[tuple[str, int]]:
    """Running heads/feet, keyed by (normalised text, top-or-bottom). Detected
    by repetition across pages rather than by matching the title, so it works
    on documents whose running head is a chapter name or a journal citation."""
    page_count = len(pages)
    if page_count < _CHROME_MIN_PAGES:
        return set()

    seen: Counter[tuple[str, int]] = Counter()
    for blocks in pages:
        # A key is counted at most once per page: a phrase genuinely repeated
        # twice on one page shouldn't reach the threshold twice as fast.
        on_this_page = set()
        for block in blocks:
            edge = _edge_of(block)
            if edge is None:
                continue
            on_this_page.add((_normalise_for_repeat(block["text"]), edge))
        seen.update(on_this_page)

    threshold = max(_CHROME_MIN_PAGES, int(page_count * _CHROME_PAGE_RATIO))
    return {key for key, count in seen.items() if count >= threshold}


def _edge_of(block: dict) -> int | None:
    """0 if the block sits in the top band, 1 in the bottom band, else None."""
    if block["y_frac"] <= _CHROME_BAND:
        return 0
    if block["y_frac"] >= 1.0 - _CHROME_BAND:
        return 1
    return None


def _body_size(pages: list[list[dict]]) -> float:
    """The document's modal font size, weighted by how much text is set in
    it — that is body copy by definition, and every heading test is relative
    to it rather than to an absolute point size."""
    weighted: Counter[int] = Counter()
    for blocks in pages:
        for block in blocks:
            if block["size"] > 0:
                weighted[round(block["size"])] += len(block["text"])
    if not weighted:
        return 0.0
    return float(weighted.most_common(1)[0][0])


def _reflow(lines: list[str]) -> str:
    """Rejoin hard-wrapped lines into one paragraph, undoing end-of-line
    hyphenation. `recon-\\nstruct` becomes `reconstruct`, but an em-dash or a
    genuine compound at a line end keeps its hyphen."""
    out = ""
    for i, raw in enumerate(lines):
        line = raw.strip()
        if not line:
            continue
        if i == 0:
            out = line
            continue
        if _LINE_HYPHEN.search(out):
            # Drop the hyphen and close up, unless the next line starts with a
            # capital (usually a proper-noun compound like "Anglo-Saxon").
            if line[:1].isupper():
                out = out + line
            else:
                out = _LINE_HYPHEN.sub(r"\1", out) + line
        else:
            out = out + " " + line
    return " ".join(out.split())


def _extract_cover(doc: fitz.Document) -> tuple[bytes | None, str | None]:
    """A PDF has no cover image as metadata, so the first page is rendered as
    one. Capped at a shelf-tile-sized render rather than full resolution."""
    try:
        page = doc.load_page(0)
        pix = page.get_pixmap(matrix=fitz.Matrix(0.7, 0.7), alpha=False)
        return pix.tobytes("png"), "png"
    except Exception:
        return None, None


def _outline_chapters(
    doc: fitz.Document, first_block_on_page: dict[int, int], word_offset_at_block: list[int]
) -> list[ParsedChapter]:
    """Chapters from the PDF's own bookmark outline, which is far more
    reliable than guessing from font sizes when it exists."""
    try:
        toc = doc.get_toc()
    except Exception:
        return []

    chapters: list[ParsedChapter] = []
    for entry in toc:
        if len(entry) < 3:
            continue
        level, label, page_no = entry[0], entry[1], entry[2]
        label = " ".join(str(label).split())
        if not label or page_no < 1:
            continue

        # Outline pages are 1-based; find the first block we kept on that page
        # (or the next page that has one, for a heading whose page was chrome).
        start_block = None
        for candidate in range(page_no, min(page_no + 3, doc.page_count + 1)):
            if candidate in first_block_on_page:
                start_block = first_block_on_page[candidate]
                break
        if start_block is None:
            continue

        chapters.append(
            ParsedChapter(
                label=label,
                depth=max(0, min(2, int(level) - 1)),
                start_block=start_block,
                word_offset=word_offset_at_block[start_block],
            )
        )

    return chapters


def parse(path: Path, *, fallback_title: str) -> ParsedBook:
    doc = _open(path)
    try:
        pages = [_page_blocks(doc.load_page(i)) for i in range(doc.page_count)]
        chrome = _find_chrome(pages)
        body_size = _body_size(pages)

        blocks: list[ParsedBlock] = []
        chapters_from_headings: list[ParsedChapter] = []
        first_block_on_page: dict[int, int] = {}
        word_offset_at_block: list[int] = []
        word_offset = 0

        for page_index, page_blocks in enumerate(pages):
            page_number = page_index + 1

            for block in page_blocks:
                edge = _edge_of(block)
                if edge is not None:
                    key = (_normalise_for_repeat(block["text"]), edge)
                    if key in chrome or _is_folio(block["text"]):
                        continue

                text = _reflow(block["lines"])
                if not text:
                    continue

                words = text.split()
                word_count = len(words)

                is_heading = (
                    body_size > 0
                    and block["size"] >= body_size * _HEADING_SIZE_RATIO
                    and word_count <= _HEADING_MAX_WORDS
                )
                kind = "h2" if is_heading else "p"

                if page_number not in first_block_on_page:
                    first_block_on_page[page_number] = len(blocks)

                if is_heading:
                    chapters_from_headings.append(
                        ParsedChapter(
                            label=text, depth=1, start_block=len(blocks), word_offset=word_offset
                        )
                    )

                word_offset_at_block.append(word_offset)
                blocks.append(
                    ParsedBlock(kind=kind, text=text, word_count=word_count, page_number=page_number)
                )
                word_offset += word_count

        if not blocks:
            raise ParseError(
                "This PDF is scanned images — text extraction needs OCR, which isn't installed."
            )

        chapters = _outline_chapters(doc, first_block_on_page, word_offset_at_block)
        if not chapters:
            chapters = chapters_from_headings

        metadata = doc.metadata or {}
        title = " ".join(str(metadata.get("title") or "").split()) or fallback_title
        author = " ".join(str(metadata.get("author") or "").split()) or None

        if not chapters:
            chapters = [ParsedChapter(label=title, depth=0, start_block=0, word_offset=0)]

        cover_bytes, cover_ext = _extract_cover(doc)

        return ParsedBook(
            meta=ParsedBookMeta(title=title, author=author, language="en"),
            chapters=chapters,
            blocks=blocks,
            cover_bytes=cover_bytes,
            cover_ext=cover_ext,
            uses_native_pages=True,
        )
    finally:
        doc.close()
