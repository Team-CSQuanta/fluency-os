"""PDF parser tests (spec Phase 5).

Fixtures are generated with PyMuPDF at test time rather than committed as
binaries: the interesting cases here are *geometric* (where on the page a
line sits, how often it repeats), and building them in code states those
properties explicitly instead of hiding them inside an opaque file.
"""

import fitz
import pytest

from app.services.ingest import pdf_parser
from app.services.ingest.base import ParseError

BODY_TOP = 200.0
LINE_STEP = 16.0


def _build_pdf(path, pages, *, header=None, footer=None, toc=None):
    """`pages` is a list of page bodies; each body is a list of (text, size)
    lines laid out down the middle of the page."""
    doc = fitz.open()
    for body in pages:
        page = doc.new_page()
        if header:
            page.insert_text((72, 40), header, fontsize=9)
        if footer:
            page.insert_text((72, page.rect.height - 40), footer, fontsize=9)
        y = BODY_TOP
        for text, size in body:
            page.insert_text((72, y), text, fontsize=size)
            y += LINE_STEP + size
    if toc:
        doc.set_toc(toc)
    doc.save(str(path))
    doc.close()


def test_extracts_text_with_native_page_numbers(tmp_path):
    path = tmp_path / "book.pdf"
    _build_pdf(
        path,
        [
            [("The first page of the book.", 11)],
            [("The second page of the book.", 11)],
        ],
    )

    parsed = pdf_parser.parse(path, fallback_title="book")

    assert parsed.uses_native_pages is True
    assert [b.page_number for b in parsed.blocks] == [1, 2]
    assert "first page" in parsed.blocks[0].text
    assert "second page" in parsed.blocks[1].text


def test_strips_running_header_and_footer(tmp_path):
    """The title and folio repeat on every page. Left in, they'd interrupt
    the prose every page and be indexed for search."""
    path = tmp_path / "running.pdf"
    bodies = [[(f"Body text for page number {i}.", 11)] for i in range(1, 7)]
    _build_pdf(path, bodies, header="A History of Quiet Places", footer="Page 1")

    parsed = pdf_parser.parse(path, fallback_title="running")

    all_text = " ".join(b.text for b in parsed.blocks)
    assert "A History of Quiet Places" not in all_text
    assert "Page 1" not in all_text
    assert "Body text for page number 3." in all_text
    assert len(parsed.blocks) == 6


def test_keeps_repeated_text_that_is_not_at_an_edge(tmp_path):
    """Repetition alone isn't chrome — a refrain in the body must survive."""
    path = tmp_path / "refrain.pdf"
    bodies = [[("And so it goes, and so it goes.", 11)] for _ in range(6)]
    _build_pdf(path, bodies)

    parsed = pdf_parser.parse(path, fallback_title="refrain")

    assert len(parsed.blocks) == 6
    assert all("And so it goes" in b.text for b in parsed.blocks)


def test_short_document_keeps_its_header(tmp_path):
    """Below the minimum page count, a repeat is more likely prose than a
    running head, so nothing is stripped."""
    path = tmp_path / "short.pdf"
    _build_pdf(path, [[("Only body text here.", 11)], [("More body text.", 11)]], header="Shared Line")

    parsed = pdf_parser.parse(path, fallback_title="short")

    assert "Shared Line" in " ".join(b.text for b in parsed.blocks)


def test_scanned_pdf_fails_with_an_ocr_message(tmp_path):
    """A scanned book has no text layer. It must fail with a sentence a
    non-technical reader understands, not import as an empty book."""
    path = tmp_path / "scanned.pdf"
    doc = fitz.open()
    doc.new_page()
    doc.new_page()
    doc.save(str(path))
    doc.close()

    with pytest.raises(ParseError) as exc:
        pdf_parser.parse(path, fallback_title="scanned")

    message = str(exc.value)
    assert "scanned" in message.lower()
    assert "ocr" in message.lower()


def test_corrupt_pdf_raises_parse_error(tmp_path):
    path = tmp_path / "broken.pdf"
    path.write_bytes(b"%PDF-1.4 this is not really a pdf at all")

    with pytest.raises(ParseError):
        pdf_parser.parse(path, fallback_title="broken")


def test_uses_outline_for_chapters_when_present(tmp_path):
    path = tmp_path / "outlined.pdf"
    _build_pdf(
        path,
        [
            [("Opening paragraph of chapter one.", 11)],
            [("Opening paragraph of chapter two.", 11)],
        ],
        toc=[[1, "Chapter One", 1], [1, "Chapter Two", 2]],
    )

    parsed = pdf_parser.parse(path, fallback_title="outlined")

    assert [c.label for c in parsed.chapters] == ["Chapter One", "Chapter Two"]
    # The second chapter starts at the first block printed on page 2.
    assert parsed.chapters[1].start_block == 1


def test_falls_back_to_font_size_headings_without_an_outline(tmp_path):
    path = tmp_path / "headings.pdf"
    _build_pdf(
        path,
        [
            [
                ("Chapter One", 22),
                ("A paragraph of ordinary body copy that runs on for a while.", 11),
            ]
        ],
    )

    parsed = pdf_parser.parse(path, fallback_title="headings")

    assert any(c.label == "Chapter One" for c in parsed.chapters)
    assert parsed.blocks[0].kind == "h2"


def test_rejoins_hyphenated_line_breaks(tmp_path):
    """A PDF stores hard line breaks; a word split across two lines must come
    back as one word, or search for it will never match."""
    path = tmp_path / "hyphen.pdf"
    doc = fitz.open()
    page = doc.new_page()
    # Two lines close enough together that PyMuPDF groups them in one block.
    page.insert_text((72, 200), "The committee moved to recon-", fontsize=11)
    page.insert_text((72, 213), "struct the whole building.", fontsize=11)
    doc.save(str(path))
    doc.close()

    parsed = pdf_parser.parse(path, fallback_title="hyphen")

    text = " ".join(b.text for b in parsed.blocks)
    assert "reconstruct" in text
    assert "recon-" not in text


def test_reads_title_and_author_from_metadata(tmp_path):
    path = tmp_path / "meta.pdf"
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 200), "Some body text on the only page.", fontsize=11)
    doc.set_metadata({"title": "The Real Title", "author": "A. Writer"})
    doc.save(str(path))
    doc.close()

    parsed = pdf_parser.parse(path, fallback_title="meta")

    assert parsed.meta.title == "The Real Title"
    assert parsed.meta.author == "A. Writer"


def test_falls_back_to_filename_when_metadata_is_empty(tmp_path):
    path = tmp_path / "untitled.pdf"
    _build_pdf(path, [[("Body text with no metadata set.", 11)]])

    parsed = pdf_parser.parse(path, fallback_title="untitled")

    assert parsed.meta.title == "untitled"


def test_renders_a_cover_from_the_first_page(tmp_path):
    path = tmp_path / "cover.pdf"
    _build_pdf(path, [[("Body text on page one.", 11)]])

    parsed = pdf_parser.parse(path, fallback_title="cover")

    assert parsed.cover_ext == "png"
    assert parsed.cover_bytes is not None
    assert parsed.cover_bytes[:4] == b"\x89PNG"
