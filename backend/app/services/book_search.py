"""FTS5 query building and result shaping for in-book search (spec Phase 4).

FTS5's MATCH syntax has real operators (AND/OR/NOT/NEAR, column filters,
prefix `*`) that a raw user string would otherwise trigger — every token is
wrapped in double quotes so the query engine treats it as a literal word,
never syntax. This also means quotes/apostrophes/operators in the input
can't break the query or inject anything.
"""

import re
import sqlite3
from dataclasses import dataclass

from app.utils.time import iso8601_utc_now

_TOKEN_RE = re.compile(r"\w+", re.UNICODE)
SNIPPET_START = "\x01"
SNIPPET_END = "\x02"
_FTS_BACKFILL_FLAG = "fts_backfill_v1"


def build_match_query(raw: str) -> str | None:
    """None means "nothing to search" (empty/whitespace/punctuation-only)."""
    tokens = _TOKEN_RE.findall(raw)
    if not tokens:
        return None
    return " ".join('"' + t.replace('"', '""') + '"' for t in tokens)


@dataclass(frozen=True)
class SnippetSegment:
    text: str
    matched: bool


def parse_snippet(raw: str) -> list[SnippetSegment]:
    """Turns snippet()'s marker-delimited string into segments, so the
    frontend never has to parse (or trust) raw HTML from the database."""
    segments: list[SnippetSegment] = []
    parts = raw.split(SNIPPET_START)
    if parts[0]:
        segments.append(SnippetSegment(parts[0], False))
    for part in parts[1:]:
        matched, _, rest = part.partition(SNIPPET_END)
        if matched:
            segments.append(SnippetSegment(matched, True))
        if rest:
            segments.append(SnippetSegment(rest, False))
    return segments


def search_book(conn: sqlite3.Connection, book_id: str, query: str, limit: int = 20) -> list[sqlite3.Row]:
    match_query = build_match_query(query)
    if match_query is None:
        return []
    return conn.execute(
        """
        SELECT block_index,
               snippet(book_blocks_fts, 0, ?, ?, '…', 12) AS snippet,
               bm25(book_blocks_fts) AS rank
        FROM book_blocks_fts
        WHERE book_blocks_fts MATCH ? AND book_id = ?
        ORDER BY rank
        LIMIT ?
        """,
        (SNIPPET_START, SNIPPET_END, match_query, book_id, limit),
    ).fetchall()


def ensure_fts_backfilled(conn: sqlite3.Connection) -> None:
    """Runs once ever (per database), guarded by an app_meta flag. Ingest
    already populates book_blocks_fts for every book it imports, so under
    normal operation this is a no-op — it exists to make search correct even
    if a book's FTS rows were ever missed (a prior bug, an interrupted
    ingest, etc) without having to re-import the book."""
    already_done = conn.execute(
        "SELECT 1 FROM app_meta WHERE key = ?", (_FTS_BACKFILL_FLAG,)
    ).fetchone()
    if already_done is not None:
        return

    book_ids = [row["id"] for row in conn.execute("SELECT id FROM books WHERE ingest_status = 'ready'").fetchall()]
    for book_id in book_ids:
        conn.execute("DELETE FROM book_blocks_fts WHERE book_id = ?", (book_id,))
        conn.execute(
            "INSERT INTO book_blocks_fts (rowid, text, book_id, block_index) "
            "SELECT rowid, text, book_id, block_index FROM book_blocks WHERE book_id = ?",
            (book_id,),
        )
    conn.execute(
        "INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (_FTS_BACKFILL_FLAG, iso8601_utc_now()),
    )
    conn.commit()
