"""EPUB → blocks. Walks the spine in document order (real reading order,
not file order), maps common XHTML tags to a block kind, and pulls
title/author/language from Dublin Core metadata plus the cover image if one
is declared. "Reads acceptably" is the bar here (per the design doc) — not
perfect reflow of every publisher's markup.
"""

from pathlib import Path

import ebooklib
from ebooklib import epub

from app.services.ingest.base import ParseError, ParsedBlock, ParsedBook, ParsedBookMeta, ParsedChapter
from app.services.ingest.html_blocks import walk_html


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
        word_offset = walk_html(
            item.get_content(), blocks=blocks, chapters=chapters, word_offset=word_offset
        )

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
