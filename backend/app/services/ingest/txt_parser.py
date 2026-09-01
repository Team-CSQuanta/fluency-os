"""Reference implementation of the parser contract (see ingest/base.py).

Plain text has no chapters or metadata beyond a filename, so this is the
simplest possible parser: split on blank lines into paragraph blocks and
report everything else as defaults.
"""

from pathlib import Path

from app.services.ingest.base import ParseError, ParsedBlock, ParsedBook, ParsedBookMeta


def _read_text(path: Path) -> str:
    raw = path.read_bytes()
    if not raw:
        raise ParseError("This file is empty.")
    for encoding in ("utf-8", "utf-8-sig", "latin-1"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise ParseError("Could not detect a text encoding for this file.")


def parse(path: Path, *, fallback_title: str) -> ParsedBook:
    text = _read_text(path)

    blocks: list[ParsedBlock] = []
    for para in text.replace("\r\n", "\n").split("\n\n"):
        stripped = para.strip()
        if not stripped:
            continue
        words = stripped.split()
        blocks.append(ParsedBlock(kind="p", text=stripped, word_count=len(words)))

    if not blocks:
        raise ParseError("This file has no readable text.")

    return ParsedBook(
        meta=ParsedBookMeta(title=fallback_title, author=None, language="en"),
        chapters=[],
        blocks=blocks,
        cover_bytes=None,
        cover_ext=None,
    )
