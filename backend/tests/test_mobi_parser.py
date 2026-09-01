"""MOBI/AZW3 parser tests (spec Phase 5).

The DRM path is the one that matters most and the one that's cheapest to
test honestly: the encryption flag lives at a fixed offset in the Palm
database header, so a few dozen bytes reproduce a bought-from-Amazon file
exactly as far as this parser is concerned.
"""

import struct

import pytest

from app.services.ingest import mobi_parser
from app.services.ingest.base import ParseError

_PDB_HEADER_BYTES = 78
_RECORD0_OFFSET = _PDB_HEADER_BYTES + 8


def _build_pdb(path, encryption: int) -> None:
    """A minimal Palm database with one record, whose PalmDOC header declares
    the given encryption type (0 = none, 2 = Mobipocket DRM)."""
    header = bytearray(_PDB_HEADER_BYTES)
    header[0:8] = b"testbook"
    header[60:64] = b"BOOKMOBI"
    struct.pack_into(">H", header, 76, 1)  # one record

    record_entry = struct.pack(">I", _RECORD0_OFFSET) + b"\x00\x00\x00\x00"

    record0 = bytearray(16)
    struct.pack_into(">H", record0, 12, encryption)

    path.write_bytes(bytes(header) + record_entry + bytes(record0))


def test_drm_protected_file_is_rejected_explicitly(tmp_path):
    path = tmp_path / "bought.mobi"
    _build_pdb(path, encryption=2)

    with pytest.raises(ParseError) as exc:
        mobi_parser.parse(path, fallback_title="bought")

    message = str(exc.value).lower()
    assert "drm" in message
    assert "protected" in message


def test_legacy_encryption_is_also_rejected(tmp_path):
    path = tmp_path / "old.mobi"
    _build_pdb(path, encryption=1)

    with pytest.raises(ParseError):
        mobi_parser.parse(path, fallback_title="old")


def test_unencrypted_but_corrupt_file_fails_readably(tmp_path):
    """No DRM flag, but nothing the unpacker can read either — the user still
    gets a plain sentence rather than a library traceback."""
    path = tmp_path / "broken.mobi"
    _build_pdb(path, encryption=0)

    with pytest.raises(ParseError) as exc:
        mobi_parser.parse(path, fallback_title="broken")

    assert "could not be opened" in str(exc.value).lower()


def test_encryption_type_reads_zero_for_a_clean_file(tmp_path):
    path = tmp_path / "clean.mobi"
    _build_pdb(path, encryption=0)

    assert mobi_parser._encryption_type(path) == 0


def test_encryption_type_is_forgiving_of_junk(tmp_path):
    """An unparseable header is the unpacker's problem to report, so the DRM
    probe must not raise on a truncated file."""
    path = tmp_path / "tiny.mobi"
    path.write_bytes(b"nope")

    assert mobi_parser._encryption_type(path) == 0


def test_find_content_prefers_an_unpacked_epub(tmp_path):
    """AZW3/KF8 unpacks to a real EPUB, which the EPUB parser handles far
    better than raw HTML would."""
    (tmp_path / "book.html").write_text("<html><body><p>x</p></body></html>", encoding="utf-8")
    (tmp_path / "book.epub").write_bytes(b"PK\x03\x04fake")

    found = mobi_parser._find_content(tmp_path)

    assert found is not None and found.suffix == ".epub"


def test_find_content_picks_the_largest_html(tmp_path):
    """Classic MOBI unpacks to several HTML files; the book body is the big
    one, not the cover stub."""
    (tmp_path / "cover.html").write_text("<p>cover</p>", encoding="utf-8")
    (tmp_path / "body.html").write_text("<p>" + ("word " * 500) + "</p>", encoding="utf-8")

    found = mobi_parser._find_content(tmp_path)

    assert found is not None and found.name == "body.html"


def test_find_content_returns_none_when_there_is_nothing(tmp_path):
    (tmp_path / "notes.txt").write_text("no markup here", encoding="utf-8")

    assert mobi_parser._find_content(tmp_path) is None
