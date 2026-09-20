"""PDF → blocks (spec §4.3, Phase 5).

A PDF is a *rendering* format, not a text format: it stores positioned glyph
runs, not paragraphs. Everything here is the work of reconstructing prose
from geometry, and "reads acceptably" is the bar rather than perfection.

Five problems get solved, in order:

1. **No text layer.** A scanned book is images of pages. There is nothing to
   extract, and we say so plainly instead of importing an empty book.
2. **Reading order.** A PDF lists its text in whatever order the generator
   happened to draw it, which on a two-column page interleaves the columns —
   left, right, left, right — and produces text that changes subject every
   sentence. Blocks are sorted, and columns are detected and read in turn.
3. **Running heads and folios.** The book's title and page number repeat on
   almost every page. Left in, they interrupt the prose mid-sentence every
   275 words, so they're detected by *position plus repetition* and dropped.
4. **Footnotes and tables.** Both are laid out as ordinary text and both read
   as gibberish inline: a footnote cuts a sentence in half, and a table's
   cells arrive as a run-on paragraph. Footnotes are moved to the end of the
   page they belong to, and tables are rebuilt row by row.
5. **Lines, not paragraphs.** A PDF stores hard line breaks. They're rejoined
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

# A footnote is set smaller than body copy and sits low on the page. Both
# tests are required: small text halfway up a page is a caption or an aside,
# and full-size text at the foot of a page is just the last paragraph.
_FOOTNOTE_BAND = 0.62
_FOOTNOTE_SIZE_RATIO = 0.92

# Below this many lines a page has no layout to speak of, and the column
# detector is far more likely to invent a gutter than to find one.
_MIN_LINES_FOR_COLUMNS = 8
# Each column has to hold at least this many lines. Without it, two stray
# short lines either side of the middle are enough to declare a column break.
_MIN_LINES_PER_COLUMN = 3
# Where a gutter can be, as a fraction of page width. A column break outside
# this band would make one column twice the width of the other.
_GUTTER_BAND = (0.35, 0.65)
_GUTTER_SAMPLES = 30
# Columns sit SIDE BY SIDE, so the two halves must overlap vertically. Without
# this a page whose text happens to alternate between two indents reads as two
# columns and gets shuffled.
_MIN_COLUMN_OVERLAP = 0.3

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
    """The page's text blocks, in the order a person reads them.

    Single-column pages need nothing but PyMuPDF's own output. Two-column
    pages need the whole of this module's geometry, because PyMuPDF groups a
    left-hand line and the right-hand line beside it into ONE block — so by
    the time a caller sees blocks the columns are already interleaved inside
    the text, and no amount of sorting can separate them again.

    The way out is to find the gutter from the LINES, which do stay in their
    own column, and then re-extract each column through a clip rectangle so
    that PyMuPDF assembles its paragraphs within one column at a time.

    Every block carries a `seq`, its position in reading order, because the
    table pass merges its own blocks into this list afterwards and sorting by
    position alone would put a two-column page back the way it was."""
    try:
        raw = page.get_text("dict")
    except Exception:
        return []

    gutter = _find_gutter(_lines_of(raw), float(page.rect.width))
    if gutter is None:
        blocks = _blocks_of(raw, float(page.rect.height))
    else:
        blocks = []
        seen: set[tuple[int, int, str]] = set()
        for region in _reading_regions(page, raw, gutter):
            if region.is_empty:
                continue
            try:
                clipped = page.get_text("dict", clip=region)
            except Exception:
                continue
            for block in _blocks_of(clipped, float(page.rect.height)):
                # Regions tile the page, but a line that straddles a boundary
                # could still be handed back for both sides of it.
                key = (round(block["x0"]), round(block["y0"]), block["text"][:40])
                if key in seen:
                    continue
                seen.add(key)
                blocks.append(block)

    for seq, block in enumerate(blocks):
        block["seq"] = seq
    return blocks


def _lines_of(raw: dict) -> list[dict]:
    """Every text line's box. Columns are detected from these rather than from
    blocks: a block can span the gutter, a line of text never does."""
    out: list[dict] = []
    for block in raw.get("blocks", []):
        if block.get("type") != 0:
            continue
        for line in block.get("lines", []):
            if not any(span.get("text", "").strip() for span in line.get("spans", [])):
                continue
            x0, y0, x1, y1 = (float(v) for v in line.get("bbox", (0, 0, 0, 0)))
            out.append({"x0": x0, "y0": y0, "x1": x1, "y1": y1})
    return out


def _merge_ranges(ranges: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """Overlapping vertical ranges collapsed into one each."""
    merged: list[tuple[float, float]] = []
    for start, end in sorted(ranges):
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))
    return merged


def _reading_regions(page: fitz.Page, raw: dict, gutter: float) -> list[fitz.Rect]:
    """The page cut into pieces, in reading order.

    Anything spanning the gutter — a chapter title, a wide figure caption —
    ends one pair of columns and begins another, so it becomes a full-width
    band of its own. Without that, a two-column page with a heading partway
    down reads its whole left column, heading included, before anything on
    the right."""
    width = float(page.rect.width)
    height = float(page.rect.height)
    spanning = [line for line in _lines_of(raw) if line["x0"] < gutter < line["x1"]]
    bands = _merge_ranges([(line["y0"], line["y1"]) for line in spanning])

    regions: list[fitz.Rect] = []
    y = 0.0
    for y0, y1 in bands:
        if y0 > y:
            regions.append(fitz.Rect(0, y, gutter, y0))
            regions.append(fitz.Rect(gutter, y, width, y0))
        regions.append(fitz.Rect(0, y0, width, y1))
        y = y1
    if y < height:
        regions.append(fitz.Rect(0, y, gutter, height))
        regions.append(fitz.Rect(gutter, y, width, height))
    return regions


def _blocks_of(raw: dict, height: float) -> list[dict]:
    """One entry per text block: its text lines, where it sits on the page,
    and its largest font size.

    The full bounding box is kept, not just the top edge: the table pass needs
    the horizontal extent to tell which blocks are cells of a table rather
    than prose, and the footnote pass needs the vertical one."""
    out: list[dict] = []
    height = height or 1.0

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

        x0, y0, x1, y1 = (float(v) for v in block.get("bbox", (0, 0, 0, 0)))
        out.append(
            {
                "lines": lines,
                "text": " ".join(" ".join(lines).split()),
                "x0": x0,
                "x1": x1,
                "y0": y0,
                "y1": y1,
                "y_frac": y0 / height,
                "size": max_size,
            }
        )

    return out


def _has_table_rules(page: fitz.Page) -> bool:
    """Whether the page has enough ruled lines to hold a ruled table.

    A pre-filter, and purely one of cost: the table finder is around 130ms a
    page and this is around 4ms, so on a book whose pages are unruled prose —
    which is most books — it saves minutes of ingest for an identical result.
    The finder's default strategy only sees tables drawn with lines anyway, so
    a page with none cannot yield one."""
    try:
        drawings = page.get_drawings()
    except Exception:
        return False

    horizontal = vertical = 0
    for drawing in drawings:
        for item in drawing.get("items", []):
            if item[0] == "l":
                p1, p2 = item[1], item[2]
                if abs(p1.y - p2.y) < 1.0 and abs(p1.x - p2.x) > 20:
                    horizontal += 1
                elif abs(p1.x - p2.x) < 1.0 and abs(p1.y - p2.y) > 20:
                    vertical += 1
            elif item[0] == "re":
                rect = item[1]
                if rect.height < 1.5 and rect.width > 20:
                    horizontal += 1
                elif rect.width < 1.5 and rect.height > 20:
                    vertical += 1
        if horizontal >= 3 or vertical >= 2:
            return True
    return False


def _table_blocks(page: fitz.Page) -> list[dict]:
    """Tables on the page, each as one pseudo-block carrying its rows.

    It takes part in the ordering pass exactly as a paragraph does, so a table
    ends up where it was printed rather than appended to the page."""
    if not _has_table_rules(page):
        return []
    try:
        found = page.find_tables()
    except Exception:
        return []

    out: list[dict] = []
    for table in getattr(found, "tables", []):
        try:
            rows = table.extract()
            x0, y0, x1, y1 = (float(v) for v in table.bbox)
        except Exception:
            continue

        cleaned: list[list[str]] = []
        for row in rows:
            cells = [" ".join(str(cell).split()) for cell in row if cell]
            if cells:
                cleaned.append(cells)

        # One row, or one column, is a layout device rather than a table —
        # rebuilding it as a table would be worse than leaving it as prose.
        if len(cleaned) < 2 or max(len(r) for r in cleaned) < 2:
            continue

        out.append({"rows": cleaned, "x0": x0, "x1": x1, "y0": y0, "y1": y1})
    return out


def _seq_near(blocks: list[dict], table: dict) -> float:
    """Where a table sits in the reading order when none of its cells were
    picked up as text — a table drawn as vector outlines with its labels
    somewhere else. Falls in just ahead of the first block below it."""
    below = [b["seq"] for b in blocks if b["y0"] >= table["y0"]]
    return min(below) - 0.5 if below else len(blocks)


def _within(block: dict, outer: dict) -> bool:
    """Whether a block's centre falls inside another's box."""
    cx = (block["x0"] + block["x1"]) / 2
    cy = (block["y0"] + block["y1"]) / 2
    return outer["x0"] <= cx <= outer["x1"] and outer["y0"] <= cy <= outer["y1"]


def _find_gutter(lines: list[dict], page_width: float) -> float | None:
    """The x of a vertical corridor the text runs either side of, or None for
    a single-column page.

    Sampled rather than clustered: walking candidate positions across the
    middle of the page and counting what crosses each is enough to find a
    gutter, and has no parameters to tune beyond where to look. A handful of
    crossings is allowed and expected — a heading or a figure spanning both
    columns is exactly what the caller needs to know about.

    On a single-column page nearly every line runs margin to margin and so
    crosses every candidate, which is what rules the whole page out."""
    if page_width <= 0 or len(lines) < _MIN_LINES_FOR_COLUMNS:
        return None

    lo = page_width * _GUTTER_BAND[0]
    hi = page_width * _GUTTER_BAND[1]
    allowed_crossings = max(1, len(lines) // 10)

    best: tuple[int, float] | None = None
    for step in range(_GUTTER_SAMPLES + 1):
        x = lo + (hi - lo) * step / _GUTTER_SAMPLES
        crossing = sum(1 for b in lines if b["x0"] < x < b["x1"])
        if crossing > allowed_crossings:
            continue

        left = [b for b in lines if b["x1"] <= x]
        right = [b for b in lines if b["x0"] >= x]
        if len(left) < _MIN_LINES_PER_COLUMN or len(right) < _MIN_LINES_PER_COLUMN:
            continue
        if not _vertically_overlapping(left, right):
            continue

        # The most even split wins: a true gutter has comparable text either
        # side of it, while a spurious one clips a couple of stray blocks off.
        score = -abs(len(left) - len(right))
        if best is None or score > best[0]:
            best = (score, x)

    return best[1] if best else None


def _vertically_overlapping(left: list[dict], right: list[dict]) -> bool:
    """Whether two groups of blocks occupy the same band of the page."""
    l0, l1 = min(b["y0"] for b in left), max(b["y1"] for b in left)
    r0, r1 = min(b["y0"] for b in right), max(b["y1"] for b in right)
    overlap = min(l1, r1) - max(l0, r0)
    shorter = min(l1 - l0, r1 - r0)
    return shorter > 0 and overlap / shorter >= _MIN_COLUMN_OVERLAP


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


def _is_footnote(block: dict, body_size: float) -> bool:
    if body_size <= 0 or block.get("rows"):
        return False
    return (
        block["y_frac"] >= _FOOTNOTE_BAND
        and block["size"] > 0
        and block["size"] <= body_size * _FOOTNOTE_SIZE_RATIO
    )


def _split_footnotes(blocks: list[dict], body_size: float) -> tuple[list[dict], list[dict]]:
    """Body text, then the page's footnotes.

    Moved rather than dropped. Inline they cut a sentence in half — the eye
    skips them on paper because they are set small and ruled off, and neither
    of those survives being turned into a paragraph. At the end of the page
    they are still there to be read, and still searchable.

    A page that is nothing but small type low down is not a page of footnotes;
    it is a short page. So this only fires when there is body text above."""
    notes = [b for b in blocks if _is_footnote(b, body_size)]
    if not notes or len(notes) == len(blocks):
        return blocks, []
    body = [b for b in blocks if not _is_footnote(b, body_size)]
    return body, notes


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
        loaded = [doc.load_page(i) for i in range(doc.page_count)]
        pages = [_page_blocks(page) for page in loaded]
        chrome = _find_chrome(pages)
        body_size = _body_size(pages)

        blocks: list[ParsedBlock] = []
        chapters_from_headings: list[ParsedChapter] = []
        first_block_on_page: dict[int, int] = {}
        word_offset_at_block: list[int] = []
        word_offset = 0

        for page_index, page_blocks in enumerate(pages):
            page_number = page_index + 1
            page = loaded[page_index]

            # Chrome first: a running head is not prose, and leaving it in
            # would let it stand in for the body text the footnote split and
            # the column detector both look for.
            kept = [
                block
                for block in page_blocks
                if not (
                    _edge_of(block) is not None
                    and (
                        (_normalise_for_repeat(block["text"]), _edge_of(block)) in chrome
                        or _is_folio(block["text"])
                    )
                )
            ]

            tables = _table_blocks(page)
            if tables:
                # A table's cells come back from the text pass as loose
                # paragraphs too; the rebuilt table replaces them — and takes
                # their place in the reading order, so it lands where it was
                # printed rather than at the end of the page.
                for table in tables:
                    cells = [b for b in kept if _within(b, table)]
                    table["seq"] = min((b["seq"] for b in cells), default=_seq_near(kept, table))
                kept = [b for b in kept if not any(_within(b, t) for t in tables)]

            ordered = sorted(kept + tables, key=lambda b: b["seq"])
            body, notes = _split_footnotes(ordered, body_size)

            # Paired with a flag rather than testing membership of `notes`:
            # these are plain dicts, so `in` compares by value and two
            # identical footnotes on one page would both match the first.
            for block, is_note in [(b, False) for b in body] + [(b, True) for b in notes]:

                if block.get("rows"):
                    emitted = [(" — ".join(row), "list") for row in block["rows"]]
                else:
                    text = _reflow(block["lines"])
                    if not text:
                        continue
                    words = len(text.split())
                    is_heading = (
                        not is_note
                        and body_size > 0
                        and block["size"] >= body_size * _HEADING_SIZE_RATIO
                        and words <= _HEADING_MAX_WORDS
                    )
                    # `caption` rather than a kind of its own: a footnote is
                    # subsidiary text set small under the body, which is what
                    # the kind already means and already styles, and adding one
                    # would mean rebuilding the table for its CHECK constraint.
                    emitted = [(text, "h2" if is_heading else "caption" if is_note else "p")]

                for text, kind in emitted:
                    if not text:
                        continue
                    word_count = len(text.split())

                    if page_number not in first_block_on_page:
                        first_block_on_page[page_number] = len(blocks)

                    if kind == "h2":
                        chapters_from_headings.append(
                            ParsedChapter(
                                label=text, depth=1, start_block=len(blocks), word_offset=word_offset
                            )
                        )

                    word_offset_at_block.append(word_offset)
                    blocks.append(
                        ParsedBlock(
                            kind=kind, text=text, word_count=word_count, page_number=page_number
                        )
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
            page_count=doc.page_count,
        )
    finally:
        doc.close()
