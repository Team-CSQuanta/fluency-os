"""MOBI/AZW3 → blocks (spec §4.3, Phase 5).

Kindle formats are a Palm database wrapper around compressed HTML. The `mobi`
package unpacks that wrapper to a directory; from there the content is either
HTML (classic MOBI) or a full EPUB (KF8/AZW3), so this parser does no markup
walking of its own — it unwraps, then hands off to the EPUB parser or the
shared HTML walker.

DRM-protected files are rejected explicitly. The encryption flag is read from
the Palm header *before* unpacking, so a bought-from-Amazon file fails in
milliseconds with an honest sentence rather than after a slow, doomed
extraction that surfaces a library traceback.
"""

import shutil
import struct
from pathlib import Path

from app.services.ingest.base import ParseError, ParsedBlock, ParsedBook, ParsedBookMeta, ParsedChapter
from app.services.ingest.html_blocks import walk_html

# Palm Database header layout: 78 fixed bytes, then one 8-byte entry per
# record. Record 0 holds the PalmDOC header, whose encryption type sits at
# offset 12: 0 = none, 1 = legacy scheme, 2 = Mobipocket DRM.
_PDB_HEADER_BYTES = 78
_NUM_RECORDS_OFFSET = 76
_ENCRYPTION_OFFSET = 12

_HTML_SUFFIXES = {".html", ".htm", ".xhtml"}


def _encryption_type(path: Path) -> int:
    """0 when the file carries no DRM. Returns 0 for anything it can't parse —
    an unreadable header is the unpacker's problem to report, not ours."""
    try:
        with path.open("rb") as f:
            header = f.read(_PDB_HEADER_BYTES + 8)
            if len(header) < _PDB_HEADER_BYTES + 8:
                return 0

            (num_records,) = struct.unpack_from(">H", header, _NUM_RECORDS_OFFSET)
            if num_records < 1:
                return 0

            (record0_offset,) = struct.unpack_from(">I", header, _PDB_HEADER_BYTES)
            f.seek(record0_offset)
            record0 = f.read(16)
            if len(record0) < _ENCRYPTION_OFFSET + 2:
                return 0

            (encryption,) = struct.unpack_from(">H", record0, _ENCRYPTION_OFFSET)
            return int(encryption)
    except (OSError, struct.error):
        return 0


def _find_content(root: Path) -> Path | None:
    """The unpacked payload: a full EPUB if the file was KF8/AZW3, otherwise
    the largest HTML document (the book body, rather than a stub cover page)."""
    epubs = sorted(root.rglob("*.epub"))
    if epubs:
        return epubs[0]

    html_files = [p for p in root.rglob("*") if p.suffix.lower() in _HTML_SUFFIXES and p.is_file()]
    if not html_files:
        return None
    return max(html_files, key=lambda p: p.stat().st_size)


def _title_from_html(content: bytes, fallback_title: str) -> str:
    try:
        from lxml import html as lxml_html

        tree = lxml_html.fromstring(content)
        found = tree.findtext(".//title")
        title = " ".join((found or "").split())
        return title or fallback_title
    except Exception:
        return fallback_title


def parse(path: Path, *, fallback_title: str) -> ParsedBook:
    if _encryption_type(path) != 0:
        raise ParseError(
            "This book is DRM-protected, so its text can't be read. "
            "Only files you own without copy protection can be imported."
        )

    try:
        import mobi
    except ImportError as exc:  # pragma: no cover - dependency is declared
        raise ParseError("MOBI support isn't available in this build.") from exc

    workdir: str | None = None
    try:
        try:
            workdir, _ = mobi.extract(str(path))
        except Exception as exc:
            raise ParseError("This Kindle file could not be opened — it may be corrupt or DRM-protected.") from exc

        content_path = _find_content(Path(workdir))
        if content_path is None:
            raise ParseError("No readable text could be extracted from this Kindle file.")

        # AZW3/KF8 unpacks to a real EPUB — reuse that parser wholesale so
        # spine order, the OPF metadata and the cover all come for free.
        if content_path.suffix.lower() == ".epub":
            from app.services.ingest import epub_parser

            return epub_parser.parse(content_path, fallback_title=fallback_title)

        content = content_path.read_bytes()
        blocks: list[ParsedBlock] = []
        chapters: list[ParsedChapter] = []
        walk_html(content, blocks=blocks, chapters=chapters, word_offset=0)

        if not blocks:
            raise ParseError("No readable text could be extracted from this Kindle file.")

        title = _title_from_html(content, fallback_title)
        if not chapters:
            chapters = [ParsedChapter(label=title, depth=0, start_block=0, word_offset=0)]

        return ParsedBook(
            meta=ParsedBookMeta(title=title, author=None, language="en"),
            chapters=chapters,
            blocks=blocks,
        )
    finally:
        if workdir:
            shutil.rmtree(workdir, ignore_errors=True)
