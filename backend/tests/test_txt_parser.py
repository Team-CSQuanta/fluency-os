import pytest

from app.services.ingest import txt_parser
from app.services.ingest.base import ParseError


def test_parses_paragraphs_split_on_blank_lines(tmp_path):
    path = tmp_path / "book.txt"
    path.write_text("First paragraph.\n\nSecond paragraph here.\n\nThird one.", encoding="utf-8")

    parsed = txt_parser.parse(path, fallback_title=path.stem)

    assert [b.text for b in parsed.blocks] == [
        "First paragraph.",
        "Second paragraph here.",
        "Third one.",
    ]
    assert parsed.blocks[0].word_count == 2
    assert parsed.meta.title == "book"
    assert parsed.meta.language == "en"
    assert parsed.chapters == []
    assert parsed.cover_bytes is None


def test_empty_file_raises(tmp_path):
    path = tmp_path / "empty.txt"
    path.write_text("", encoding="utf-8")

    with pytest.raises(ParseError):
        txt_parser.parse(path, fallback_title=path.stem)


def test_blank_only_file_raises(tmp_path):
    path = tmp_path / "blank.txt"
    path.write_text("   \n\n   \n", encoding="utf-8")

    with pytest.raises(ParseError):
        txt_parser.parse(path, fallback_title=path.stem)


def test_non_utf8_falls_back_to_latin1(tmp_path):
    path = tmp_path / "latin1.txt"
    path.write_bytes("café résumé".encode("latin-1"))

    parsed = txt_parser.parse(path, fallback_title=path.stem)

    assert parsed.blocks[0].text == "café résumé"
