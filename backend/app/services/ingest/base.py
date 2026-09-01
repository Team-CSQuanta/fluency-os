"""The parser contract every book format implements (spec §4.3 ingestion).

A parser turns one file on disk into a flat, ordered list of immutable text
blocks plus a chapter table that points into that list by start index. This
is deliberately format-agnostic: the pipeline in ingest/pipeline.py never
needs to know whether it ingested a .txt or an .epub.
"""

from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol

BlockKind = str  # one of: p, h1, h2, h3, quote, list, caption, code


@dataclass(frozen=True)
class ParsedBlock:
    kind: BlockKind
    text: str
    word_count: int
    # Set only by formats with real pages (PDF). Reflowable formats leave
    # this None and the reader derives a page from cumulative word counts.
    page_number: int | None = None


@dataclass(frozen=True)
class ParsedChapter:
    label: str
    depth: int
    start_block: int
    word_offset: int


@dataclass(frozen=True)
class ParsedBookMeta:
    title: str
    author: str | None
    language: str


@dataclass(frozen=True)
class ParsedBook:
    meta: ParsedBookMeta
    chapters: list[ParsedChapter] = field(default_factory=list)
    blocks: list[ParsedBlock] = field(default_factory=list)
    cover_bytes: bytes | None = None
    cover_ext: str | None = None
    # True when every block carries a trustworthy page_number, so the reader
    # should page by the document's own boundaries instead of by word count.
    uses_native_pages: bool = False


class BookParser(Protocol):
    def parse(self, path: Path, *, fallback_title: str) -> ParsedBook:
        """`path` is the app's own stored copy (named by book id, not the
        original filename) — `fallback_title` carries the original
        filename's stem so a format with no title metadata (or missing
        metadata) doesn't end up titled after a UUID."""
        ...


class UnsupportedFormatError(Exception):
    """Raised when no parser is registered for a book's extension."""


class ParseError(Exception):
    """Raised by a parser when the file can't be turned into text blocks
    (corrupt archive, no text layer, DRM, etc). The message is shown to the
    user verbatim in the failed tile, so it must be a plain sentence."""
