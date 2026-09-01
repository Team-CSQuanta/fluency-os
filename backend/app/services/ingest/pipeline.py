"""Orchestrates one book's ingest: hash -> copy -> parse -> persist -> FTS ->
status. The only writer of book_blocks (spec §7.1 — blocks are immutable
after ingest). Runs on a FastAPI BackgroundTask with its own DB connection,
since the request-scoped connection from `get_db` closes once the response
is sent.
"""

import hashlib
import math
import sqlite3
from pathlib import Path

from app.services import book_storage
from app.services.ingest import txt_parser
from app.services.ingest.base import BookParser, ParseError, UnsupportedFormatError
from app.utils.time import iso8601_utc_now

WORDS_PER_PAGE = 275

# PDF/MOBI/AZW3 are accepted by the file picker (forward-compatible with a
# later phase) but have no parser yet, so they fail with a clear message
# instead of the picker silently rejecting them.
_PARSERS: dict[str, BookParser] = {"txt": txt_parser}


def _load_epub_parser() -> BookParser:
    from app.services.ingest import epub_parser

    return epub_parser


def get_parser(fmt: str) -> BookParser:
    if fmt == "epub":
        return _load_epub_parser()
    parser = _PARSERS.get(fmt)
    if parser is None:
        raise UnsupportedFormatError(f"{fmt.upper()} import isn't supported yet — coming in a later phase.")
    return parser


def compute_file_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def normalise_text_hash(text: str) -> str:
    return hashlib.sha256(text.strip().lower().encode("utf-8")).hexdigest()


def find_existing_book(conn: sqlite3.Connection, user_id: str, file_hash: str) -> sqlite3.Row | None:
    return conn.execute(
        "SELECT * FROM books WHERE user_id = ? AND file_hash = ?", (user_id, file_hash)
    ).fetchone()


def create_queued_book(
    conn: sqlite3.Connection,
    *,
    book_id: str,
    user_id: str,
    source_path: Path,
    stored_path: Path,
    file_hash: str,
    file_bytes: int,
    fmt: str,
    count_toward_goal: bool,
    heat_overlay: bool,
) -> None:
    conn.execute(
        """
        INSERT INTO books (
          id, user_id, title, author, language, format, source_type, source_path,
          stored_path, file_hash, file_bytes, ingest_status, count_toward_goal,
          heat_overlay, imported_at
        )
        VALUES (?, ?, ?, NULL, 'en', ?, 'import', ?, ?, ?, ?, 'queued', ?, ?, ?)
        """,
        (
            book_id,
            user_id,
            source_path.stem,
            fmt,
            str(source_path),
            str(stored_path),
            file_hash,
            file_bytes,
            int(count_toward_goal),
            int(heat_overlay),
            iso8601_utc_now(),
        ),
    )


def ingest_book(conn: sqlite3.Connection, book_id: str) -> None:
    row = conn.execute("SELECT * FROM books WHERE id = ?", (book_id,)).fetchone()
    if row is None:
        return

    conn.execute("UPDATE books SET ingest_status = 'parsing' WHERE id = ?", (book_id,))
    conn.commit()

    try:
        parser = get_parser(row["format"])
        parsed = parser.parse(Path(row["stored_path"]), fallback_title=row["title"])

        total_words = sum(b.word_count for b in parsed.blocks)
        page_estimate = math.ceil(total_words / WORDS_PER_PAGE) if total_words else 0

        cover_path: str | None = None
        if parsed.cover_bytes:
            cover_path = str(book_storage.store_cover(parsed.cover_bytes, book_id, parsed.cover_ext or "jpg"))

        conn.execute("BEGIN")
        try:
            chapter_ids: list[str] = []
            for order_index, chapter in enumerate(parsed.chapters):
                chapter_id = f"{book_id}:{order_index}"
                chapter_ids.append(chapter_id)
                conn.execute(
                    """
                    INSERT INTO book_chapters (id, book_id, order_index, label, depth, start_block, word_offset)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (chapter_id, book_id, order_index, chapter.label, chapter.depth, chapter.start_block, chapter.word_offset),
                )

            def chapter_for_block(block_index: int) -> str | None:
                current: str | None = None
                for chapter, cid in zip(parsed.chapters, chapter_ids):
                    if chapter.start_block <= block_index:
                        current = cid
                    else:
                        break
                return current

            for block_index, block in enumerate(parsed.blocks):
                text_hash = normalise_text_hash(block.text)
                conn.execute(
                    """
                    INSERT INTO book_blocks (book_id, block_index, chapter_id, kind, text, word_count, text_hash)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (book_id, block_index, chapter_for_block(block_index), block.kind, block.text, block.word_count, text_hash),
                )

            conn.execute(
                "INSERT INTO book_blocks_fts (rowid, text, book_id, block_index) "
                "SELECT rowid, text, book_id, block_index FROM book_blocks WHERE book_id = ?",
                (book_id,),
            )

            conn.execute(
                """
                UPDATE books SET
                  title = ?, author = ?, language = ?, cover_path = ?,
                  total_blocks = ?, total_words = ?, page_estimate = ?, ingest_status = 'ready'
                WHERE id = ?
                """,
                (
                    parsed.meta.title,
                    parsed.meta.author,
                    parsed.meta.language,
                    cover_path,
                    len(parsed.blocks),
                    total_words,
                    page_estimate,
                    book_id,
                ),
            )
            conn.commit()
        except Exception:
            conn.rollback()
            raise
    except (ParseError, UnsupportedFormatError) as exc:
        conn.execute(
            "UPDATE books SET ingest_status = 'failed', ingest_error = ? WHERE id = ?", (str(exc), book_id)
        )
        conn.commit()
    except Exception as exc:  # unexpected parser crash — still surface a readable failure, not a hang
        conn.execute(
            "UPDATE books SET ingest_status = 'failed', ingest_error = ? WHERE id = ?",
            (f"Unexpected error while importing this file: {exc}", book_id),
        )
        conn.commit()
