"""EPUB → blocks. Walks the spine in document order (real reading order,
not file order), maps common XHTML tags to a block kind, and pulls
title/author/language from Dublin Core metadata plus the cover image if one
is declared. "Reads acceptably" is the bar here (per the design doc) — not
perfect reflow of every publisher's markup.
"""

from pathlib import Path

import ebooklib
from ebooklib import epub
from lxml import html as lxml_html

from app.services.ingest.base import ParseError, ParsedBlock, ParsedBook, ParsedBookMeta, ParsedChapter

_BLOCK_TAGS = {
    "p": "p",
    "h1": "h1",
    "h2": "h2",
    "h3": "h3",
    "h4": "h3",
    "h5": "h3",
    "h6": "h3",
    "blockquote": "quote",
    "li": "list",
    "figcaption": "caption",
    "pre": "code",
}
_HEADING_DEPTH = {"h1": 0, "h2": 1, "h3": 2}


def _meta_value(book: epub.EpubBook, name: str) -> str | None:
    values = book.get_metadata("DC", name)
    return values[0][0] if values else None


def parse(path: Path, *, fallback_title: str) -> ParsedBook:
    try:
        book = epub.read_epub(str(path))
    except Exception as exc:  # ebooklib raises plain Exception/KeyError on bad zips
        raise ParseError("This EPUB could not be opened — the file may be corrupt.") from exc

    title = _meta_value(book, "title") or fallback_title
    author = _meta_value(book, "creator")
    language = _meta_value(book, "language") or "en"

    spine_ids = [idref for idref, _linear in book.spine]
    if not spine_ids:
        raise ParseError("This EPUB has no readable spine.")

    blocks: list[ParsedBlock] = []
    chapters: list[ParsedChapter] = []
    word_offset = 0

    for idref in spine_ids:
        item = book.get_item_with_id(idref)
        if item is None:
            continue
        try:
            tree = lxml_html.fromstring(item.get_content())
        except Exception:
            continue

        for el in tree.iter(*_BLOCK_TAGS.keys()):
            text = " ".join("".join(el.itertext()).split())
            if not text:
                continue
            tag = el.tag
            kind = _BLOCK_TAGS[tag]
            word_count = len(text.split())

            if tag in _HEADING_DEPTH:
                chapters.append(
                    ParsedChapter(
                        label=text, depth=_HEADING_DEPTH[tag], start_block=len(blocks), word_offset=word_offset
                    )
                )

            blocks.append(ParsedBlock(kind=kind, text=text, word_count=word_count))
            word_offset += word_count

    if not blocks:
        raise ParseError("No text content could be extracted from this EPUB.")

    if not chapters:
        chapters.append(ParsedChapter(label=title, depth=0, start_block=0, word_offset=0))

    cover_bytes: bytes | None = None
    cover_ext: str | None = None
    cover_item = next(iter(book.get_items_of_type(ebooklib.ITEM_COVER)), None)
    if cover_item is None:
        cover_item = next(
            (
                it
                for it in book.get_items()
                if "cover" in (it.get_name() or "").lower() and (it.media_type or "").startswith("image/")
            ),
            None,
        )
    if cover_item is not None:
        cover_bytes = cover_item.get_content()
        cover_ext = (cover_item.media_type or "image/jpeg").split("/")[-1].split("+")[0]

    return ParsedBook(
        meta=ParsedBookMeta(title=title, author=author, language=language),
        chapters=chapters,
        blocks=blocks,
        cover_bytes=cover_bytes,
        cover_ext=cover_ext,
    )
