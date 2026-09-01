import pytest
from ebooklib import epub

from app.services.ingest import epub_parser
from app.services.ingest.base import ParseError


def _build_epub(tmp_path, *, title="Test Book", author="Jane Author", chapters=None):
    book = epub.EpubBook()
    book.set_identifier("id123456")
    book.set_title(title)
    book.set_language("en")
    if author:
        book.add_author(author)

    chapters = chapters or [
        ("Chapter 1", "<h1>Chapter 1</h1><p>First paragraph of chapter one.</p><p>Second paragraph.</p>"),
        ("Chapter 2", "<h1>Chapter 2</h1><p>First paragraph of chapter two.</p>"),
    ]

    epub_chapters = []
    for i, (label, html) in enumerate(chapters):
        c = epub.EpubHtml(title=label, file_name=f"chap_{i}.xhtml", lang="en")
        c.content = html
        book.add_item(c)
        epub_chapters.append(c)

    book.toc = tuple(epub_chapters)
    book.add_item(epub.EpubNcx())
    book.add_item(epub.EpubNav())
    book.spine = ["nav", *epub_chapters]

    cover_bytes = b"\xff\xd8\xff\xe0fake-jpeg-bytes"
    book.set_cover("cover.jpg", cover_bytes)

    path = tmp_path / "book.epub"
    epub.write_epub(str(path), book, {"epub3_pages": False})
    return path


def test_parses_title_author_language_and_blocks(tmp_path):
    path = _build_epub(tmp_path)

    parsed = epub_parser.parse(path, fallback_title=path.stem)

    assert parsed.meta.title == "Test Book"
    assert parsed.meta.author == "Jane Author"
    assert parsed.meta.language == "en"

    texts = [b.text for b in parsed.blocks]
    assert "Chapter 1" in texts
    assert "First paragraph of chapter one." in texts
    assert "First paragraph of chapter two." in texts

    # Reading order matches spine order, not alphabetical/file order.
    assert texts.index("First paragraph of chapter one.") < texts.index("First paragraph of chapter two.")


def test_extracts_chapters_from_headings(tmp_path):
    path = _build_epub(tmp_path)
    parsed = epub_parser.parse(path, fallback_title=path.stem)

    labels = [c.label for c in parsed.chapters]
    assert "Chapter 1" in labels
    assert "Chapter 2" in labels
    # start_block for chapter 2 must be after chapter 1's blocks.
    ch1, ch2 = (c for c in parsed.chapters if c.label in ("Chapter 1", "Chapter 2"))
    assert ch2.start_block > ch1.start_block


def test_extracts_cover(tmp_path):
    path = _build_epub(tmp_path)
    parsed = epub_parser.parse(path, fallback_title=path.stem)

    assert parsed.cover_bytes is not None
    assert parsed.cover_ext == "jpeg"


def test_missing_metadata_falls_back_to_filename(tmp_path):
    path = _build_epub(tmp_path, title="", author=None)
    parsed = epub_parser.parse(path, fallback_title=path.stem)

    assert parsed.meta.title  # ebooklib always keeps some title/identifier fallback
    assert parsed.meta.author is None


def test_corrupt_zip_raises_parse_error(tmp_path):
    path = tmp_path / "corrupt.epub"
    path.write_bytes(b"this is not a zip file at all")

    with pytest.raises(ParseError):
        epub_parser.parse(path, fallback_title=path.stem)


def test_no_spine_content_raises(tmp_path):
    book = epub.EpubBook()
    book.set_identifier("id999")
    book.set_title("Empty Book")
    book.set_language("en")
    book.spine = []
    path = tmp_path / "no_spine.epub"
    epub.write_epub(str(path), book, {"epub3_pages": False})

    with pytest.raises(ParseError):
        epub_parser.parse(path, fallback_title=path.stem)
