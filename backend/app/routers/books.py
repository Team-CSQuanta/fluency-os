import sqlite3
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from fastapi.responses import FileResponse

from app.db import get_connection, get_db
from app.models.books import (
    BlockOut,
    BookCountsOut,
    BookImportRequest,
    BookOut,
    BookUpdate,
    ChapterOut,
    PageOut,
    PositionOut,
    PositionUpdate,
)
from app.models.highlights import (
    BookmarkCreate,
    BookmarkOut,
    HighlightCreate,
    HighlightOut,
    HighlightUpdate,
)
from app.models.search import SearchHitOut, SnippetSegmentOut
from app.security import require_token
from app.services import book_search, book_storage, pagination
from app.services.ingest import pipeline
from app.utils.ids import uuid7
from app.utils.time import iso8601_utc_now

router = APIRouter(prefix="/books", dependencies=[Depends(require_token)])


def _row_to_book(row: sqlite3.Row) -> BookOut:
    return BookOut(
        id=row["id"],
        user_id=row["user_id"],
        title=row["title"],
        author=row["author"],
        language=row["language"],
        format=row["format"],
        cover_path=row["cover_path"],
        total_blocks=row["total_blocks"],
        total_words=row["total_words"],
        page_estimate=row["page_estimate"],
        ingest_status=row["ingest_status"],
        ingest_error=row["ingest_error"],
        count_toward_goal=bool(row["count_toward_goal"]),
        heat_overlay=bool(row["heat_overlay"]),
        imported_at=row["imported_at"],
        finished_at=row["finished_at"],
    )


def _get_book_row(conn: sqlite3.Connection, book_id: str) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM books WHERE id = ?", (book_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Book not found")
    return row


def _run_ingest_in_background(book_id: str) -> None:
    conn = get_connection()
    try:
        pipeline.ingest_book(conn, book_id)
    finally:
        conn.close()


@router.post("/import", status_code=status.HTTP_202_ACCEPTED, response_model=list[BookOut])
def import_books(
    payload: BookImportRequest,
    background_tasks: BackgroundTasks,
    conn: sqlite3.Connection = Depends(get_db),
) -> list[BookOut]:
    results: list[sqlite3.Row] = []

    for raw_path in payload.paths:
        source_path = Path(raw_path)
        fmt = source_path.suffix.lstrip(".").lower()

        if not source_path.is_file():
            book_id = uuid7()
            conn.execute(
                """
                INSERT INTO books (
                  id, user_id, title, author, language, format, source_type, source_path,
                  stored_path, file_hash, file_bytes, ingest_status, ingest_error,
                  count_toward_goal, heat_overlay, imported_at
                )
                VALUES (?, ?, ?, NULL, 'en', ?, 'import', ?, '', ?, 0, 'failed', ?, ?, ?, ?)
                """,
                (
                    book_id,
                    payload.user_id,
                    source_path.stem,
                    fmt if fmt in ("epub", "pdf", "mobi", "azw3", "txt") else "txt",
                    raw_path,
                    f"missing:{book_id}",  # unique placeholder so (user_id, file_hash) never collides across failed imports
                    "File not found or unreadable.",
                    int(payload.count_toward_goal),
                    int(payload.heat_overlay),
                    iso8601_utc_now(),
                ),
            )
            results.append(_get_book_row(conn, book_id))
            continue

        file_hash = pipeline.compute_file_hash(source_path)
        existing = pipeline.find_existing_book(conn, payload.user_id, file_hash)
        if existing is not None:
            results.append(existing)
            continue

        book_id = uuid7()
        stored_path = book_storage.store_book_file(source_path, book_id)
        pipeline.create_queued_book(
            conn,
            book_id=book_id,
            user_id=payload.user_id,
            source_path=source_path,
            stored_path=stored_path,
            file_hash=file_hash,
            file_bytes=source_path.stat().st_size,
            fmt=fmt,
            count_toward_goal=payload.count_toward_goal,
            heat_overlay=payload.heat_overlay,
        )
        results.append(_get_book_row(conn, book_id))
        # get_db's post-yield commit runs after BackgroundTasks in this FastAPI
        # version, so the queued row must be committed here or the background
        # task's own connection won't see it yet.
        conn.commit()
        background_tasks.add_task(_run_ingest_in_background, book_id)

    return [_row_to_book(row) for row in results]


@router.get("", response_model=list[BookOut])
def list_books(
    user_id: str, status: str | None = None, conn: sqlite3.Connection = Depends(get_db)
) -> list[BookOut]:
    if status:
        rows = conn.execute(
            "SELECT * FROM books WHERE user_id = ? AND ingest_status = ? ORDER BY imported_at DESC",
            (user_id, status),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM books WHERE user_id = ? ORDER BY imported_at DESC", (user_id,)
        ).fetchall()
    return [_row_to_book(row) for row in rows]


@router.get("/counts", response_model=BookCountsOut)
def get_counts(user_id: str, conn: sqlite3.Connection = Depends(get_db)) -> BookCountsOut:
    all_count = conn.execute("SELECT COUNT(*) AS c FROM books WHERE user_id = ?", (user_id,)).fetchone()["c"]
    finished = conn.execute(
        "SELECT COUNT(*) AS c FROM books WHERE user_id = ? AND finished_at IS NOT NULL", (user_id,)
    ).fetchone()["c"]
    # A book only has a reading_positions row once it's been opened at least
    # once (PUT /books/{id}/position writes the first row on open).
    reading = conn.execute(
        """
        SELECT COUNT(*) AS c FROM books b
        JOIN reading_positions p ON p.book_id = b.id AND p.user_id = b.user_id
        WHERE b.user_id = ? AND b.finished_at IS NULL
        """,
        (user_id,),
    ).fetchone()["c"]
    not_started = conn.execute(
        "SELECT COUNT(*) AS c FROM books WHERE user_id = ? AND ingest_status = 'ready' AND finished_at IS NULL",
        (user_id,),
    ).fetchone()["c"] - reading
    return BookCountsOut(all=all_count, reading=reading, not_started=max(0, not_started), finished=finished)


@router.get("/{book_id}", response_model=BookOut)
def get_book(book_id: str, conn: sqlite3.Connection = Depends(get_db)) -> BookOut:
    return _row_to_book(_get_book_row(conn, book_id))


@router.get("/{book_id}/cover")
def get_cover(book_id: str, conn: sqlite3.Connection = Depends(get_db)) -> FileResponse:
    row = _get_book_row(conn, book_id)
    if not row["cover_path"] or not Path(row["cover_path"]).is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No cover for this book")
    return FileResponse(row["cover_path"])


@router.get("/{book_id}/toc", response_model=list[ChapterOut])
def get_toc(book_id: str, conn: sqlite3.Connection = Depends(get_db)) -> list[ChapterOut]:
    _get_book_row(conn, book_id)
    rows = conn.execute(
        "SELECT * FROM book_chapters WHERE book_id = ? ORDER BY order_index", (book_id,)
    ).fetchall()
    return [
        ChapterOut(
            id=row["id"],
            order_index=row["order_index"],
            label=row["label"],
            depth=row["depth"],
            start_block=row["start_block"],
            page=pagination.page_number(row["word_offset"]),
        )
        for row in rows
    ]


@router.get("/{book_id}/blocks", response_model=list[BlockOut])
def get_blocks(
    book_id: str, from_index: int = 0, limit: int = 60, conn: sqlite3.Connection = Depends(get_db)
) -> list[BlockOut]:
    _get_book_row(conn, book_id)
    rows = conn.execute(
        "SELECT * FROM book_blocks WHERE book_id = ? AND block_index >= ? ORDER BY block_index LIMIT ?",
        (book_id, from_index, limit),
    ).fetchall()
    return [
        BlockOut(
            block_index=row["block_index"],
            chapter_id=row["chapter_id"],
            kind=row["kind"],
            text=row["text"],
            word_count=row["word_count"],
        )
        for row in rows
    ]


@router.get("/{book_id}/page", response_model=PageOut)
def get_page(book_id: str, page: int = 1, conn: sqlite3.Connection = Depends(get_db)) -> PageOut:
    """Groups blocks into pages at block boundaries — a page is never split
    mid-paragraph. Each block belongs to whichever page its own cumulative
    starting word offset falls on (spec's 275-words-per-page rule), computed
    with a running-total window function so this stays one query."""
    book = _get_book_row(conn, book_id)
    total_pages = pagination.total_pages(book["total_words"])
    page = max(1, page)
    if total_pages:
        page = min(page, total_pages)

    rows = conn.execute(
        f"""
        WITH cum AS (
          SELECT block_index, chapter_id, kind, text, word_count,
                 COALESCE(SUM(word_count) OVER (
                   ORDER BY block_index ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
                 ), 0) AS word_offset_before
          FROM book_blocks WHERE book_id = ?
        )
        SELECT * FROM cum WHERE (word_offset_before / {pagination.WORDS_PER_PAGE}) + 1 = ? ORDER BY block_index
        """,
        (book_id, page),
    ).fetchall()

    blocks = [
        BlockOut(
            block_index=row["block_index"],
            chapter_id=row["chapter_id"],
            kind=row["kind"],
            text=row["text"],
            word_count=row["word_count"],
        )
        for row in rows
    ]
    return PageOut(
        page=page,
        total_pages=total_pages,
        blocks=blocks,
        has_prev=page > 1,
        has_next=total_pages > 0 and page < total_pages,
        first_block_index=blocks[0].block_index if blocks else 0,
    )


def _word_offset_before(conn: sqlite3.Connection, book_id: str, block_index: int) -> int:
    row = conn.execute(
        "SELECT COALESCE(SUM(word_count), 0) AS w FROM book_blocks WHERE book_id = ? AND block_index < ?",
        (book_id, block_index),
    ).fetchone()
    return row["w"]


@router.get("/{book_id}/position", response_model=PositionOut)
def get_position(book_id: str, user_id: str, conn: sqlite3.Connection = Depends(get_db)) -> PositionOut:
    book = _get_book_row(conn, book_id)
    row = conn.execute(
        "SELECT * FROM reading_positions WHERE book_id = ? AND user_id = ?", (book_id, user_id)
    ).fetchone()
    block_index = row["block_index"] if row else 0
    char_offset = row["char_offset"] if row else 0
    max_seen = row["max_block_seen"] if row else 0
    word_offset = _word_offset_before(conn, book_id, block_index)
    return PositionOut(
        block_index=block_index,
        char_offset=char_offset,
        max_block_seen=max_seen,
        page=pagination.page_number(word_offset),
        total_pages=pagination.total_pages(book["total_words"]),
        percent=pagination.percent_complete(max_seen, book["total_blocks"]),
    )


@router.put("/{book_id}/position", status_code=status.HTTP_204_NO_CONTENT)
def update_position(book_id: str, payload: PositionUpdate, conn: sqlite3.Connection = Depends(get_db)) -> None:
    book = _get_book_row(conn, book_id)
    if payload.block_index < 0 or (book["total_blocks"] and payload.block_index >= book["total_blocks"]):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="block_index out of range")

    existing = conn.execute(
        "SELECT max_block_seen FROM reading_positions WHERE book_id = ? AND user_id = ?",
        (book_id, payload.user_id),
    ).fetchone()
    # max_block_seen only ever increases (spec §7.1) — flipping back to an
    # earlier chapter to re-read must not wipe a mostly-read book's progress.
    max_seen = max(payload.block_index, existing["max_block_seen"] if existing else 0)

    conn.execute(
        """
        INSERT INTO reading_positions (book_id, user_id, block_index, char_offset, max_block_seen, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(book_id, user_id) DO UPDATE SET
          block_index = excluded.block_index,
          char_offset = excluded.char_offset,
          max_block_seen = excluded.max_block_seen,
          updated_at = excluded.updated_at
        """,
        (book_id, payload.user_id, payload.block_index, payload.char_offset, max_seen, iso8601_utc_now()),
    )


def _block_page(conn: sqlite3.Connection, book_id: str, block_index: int) -> int:
    return pagination.page_number(_word_offset_before(conn, book_id, block_index))


def _row_to_highlight(conn: sqlite3.Connection, row: sqlite3.Row) -> HighlightOut:
    return HighlightOut(
        id=row["id"],
        book_id=row["book_id"],
        user_id=row["user_id"],
        block_index=row["block_index"],
        start_char=row["start_char"],
        end_char=row["end_char"],
        colour=row["colour"],
        quoted_text=row["quoted_text"],
        note=row["note"],
        created_at=row["created_at"],
        page=_block_page(conn, row["book_id"], row["block_index"]),
    )


def _get_highlight_row(conn: sqlite3.Connection, book_id: str, highlight_id: str) -> sqlite3.Row:
    row = conn.execute(
        "SELECT * FROM book_highlights WHERE id = ? AND book_id = ?", (highlight_id, book_id)
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Highlight not found")
    return row


@router.get("/{book_id}/highlights", response_model=list[HighlightOut])
def list_highlights(book_id: str, user_id: str, conn: sqlite3.Connection = Depends(get_db)) -> list[HighlightOut]:
    _get_book_row(conn, book_id)
    rows = conn.execute(
        "SELECT * FROM book_highlights WHERE book_id = ? AND user_id = ? ORDER BY block_index, start_char",
        (book_id, user_id),
    ).fetchall()
    return [_row_to_highlight(conn, row) for row in rows]


@router.post("/{book_id}/highlights", response_model=HighlightOut, status_code=status.HTTP_201_CREATED)
def create_highlight(
    book_id: str, payload: HighlightCreate, conn: sqlite3.Connection = Depends(get_db)
) -> HighlightOut:
    book = _get_book_row(conn, book_id)
    if payload.end_char <= payload.start_char:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="end_char must be greater than start_char")
    if payload.block_index < 0 or (book["total_blocks"] and payload.block_index >= book["total_blocks"]):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="block_index out of range")

    highlight_id = uuid7()
    conn.execute(
        """
        INSERT INTO book_highlights (id, book_id, user_id, block_index, start_char, end_char, colour, quoted_text, note, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            highlight_id,
            book_id,
            payload.user_id,
            payload.block_index,
            payload.start_char,
            payload.end_char,
            payload.colour,
            payload.quoted_text,
            payload.note,
            iso8601_utc_now(),
        ),
    )
    return _row_to_highlight(conn, _get_highlight_row(conn, book_id, highlight_id))


@router.patch("/{book_id}/highlights/{highlight_id}", response_model=HighlightOut)
def update_highlight(
    book_id: str, highlight_id: str, payload: HighlightUpdate, conn: sqlite3.Connection = Depends(get_db)
) -> HighlightOut:
    _get_highlight_row(conn, book_id, highlight_id)
    fields = payload.model_dump(exclude_unset=True)
    if fields:
        set_clause = ", ".join(f"{k} = ?" for k in fields)
        conn.execute(f"UPDATE book_highlights SET {set_clause} WHERE id = ?", (*fields.values(), highlight_id))
    return _row_to_highlight(conn, _get_highlight_row(conn, book_id, highlight_id))


@router.delete("/{book_id}/highlights/{highlight_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_highlight(book_id: str, highlight_id: str, conn: sqlite3.Connection = Depends(get_db)) -> None:
    _get_highlight_row(conn, book_id, highlight_id)
    conn.execute("DELETE FROM book_highlights WHERE id = ?", (highlight_id,))


def _row_to_bookmark(conn: sqlite3.Connection, row: sqlite3.Row) -> BookmarkOut:
    return BookmarkOut(
        id=row["id"],
        book_id=row["book_id"],
        user_id=row["user_id"],
        block_index=row["block_index"],
        label=row["label"],
        created_at=row["created_at"],
        page=_block_page(conn, row["book_id"], row["block_index"]),
    )


def _get_bookmark_row(conn: sqlite3.Connection, book_id: str, bookmark_id: str) -> sqlite3.Row:
    row = conn.execute(
        "SELECT * FROM book_bookmarks WHERE id = ? AND book_id = ?", (bookmark_id, book_id)
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bookmark not found")
    return row


@router.get("/{book_id}/bookmarks", response_model=list[BookmarkOut])
def list_bookmarks(book_id: str, user_id: str, conn: sqlite3.Connection = Depends(get_db)) -> list[BookmarkOut]:
    _get_book_row(conn, book_id)
    rows = conn.execute(
        "SELECT * FROM book_bookmarks WHERE book_id = ? AND user_id = ? ORDER BY block_index", (book_id, user_id)
    ).fetchall()
    return [_row_to_bookmark(conn, row) for row in rows]


@router.post("/{book_id}/bookmarks", response_model=BookmarkOut, status_code=status.HTTP_201_CREATED)
def create_bookmark(book_id: str, payload: BookmarkCreate, conn: sqlite3.Connection = Depends(get_db)) -> BookmarkOut:
    book = _get_book_row(conn, book_id)
    if payload.block_index < 0 or (book["total_blocks"] and payload.block_index >= book["total_blocks"]):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="block_index out of range")

    bookmark_id = uuid7()
    conn.execute(
        "INSERT INTO book_bookmarks (id, book_id, user_id, block_index, label, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        (bookmark_id, book_id, payload.user_id, payload.block_index, payload.label, iso8601_utc_now()),
    )
    return _row_to_bookmark(conn, _get_bookmark_row(conn, book_id, bookmark_id))


@router.delete("/{book_id}/bookmarks/{bookmark_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_bookmark(book_id: str, bookmark_id: str, conn: sqlite3.Connection = Depends(get_db)) -> None:
    _get_bookmark_row(conn, book_id, bookmark_id)
    conn.execute("DELETE FROM book_bookmarks WHERE id = ?", (bookmark_id,))


def _chapter_label_for_block(conn: sqlite3.Connection, book_id: str, block_index: int) -> str | None:
    row = conn.execute(
        "SELECT label FROM book_chapters WHERE book_id = ? AND start_block <= ? ORDER BY start_block DESC LIMIT 1",
        (book_id, block_index),
    ).fetchone()
    return row["label"] if row else None


@router.get("/{book_id}/search", response_model=list[SearchHitOut])
def search_book(
    book_id: str, q: str, limit: int = 20, conn: sqlite3.Connection = Depends(get_db)
) -> list[SearchHitOut]:
    _get_book_row(conn, book_id)
    rows = book_search.search_book(conn, book_id, q, limit=limit)
    return [
        SearchHitOut(
            block_index=row["block_index"],
            page=_block_page(conn, book_id, row["block_index"]),
            chapter_label=_chapter_label_for_block(conn, book_id, row["block_index"]),
            snippet=[
                SnippetSegmentOut(text=seg.text, matched=seg.matched)
                for seg in book_search.parse_snippet(row["snippet"])
            ],
        )
        for row in rows
    ]


@router.patch("/{book_id}", response_model=BookOut)
def update_book(book_id: str, payload: BookUpdate, conn: sqlite3.Connection = Depends(get_db)) -> BookOut:
    _get_book_row(conn, book_id)
    fields = payload.model_dump(exclude_unset=True)
    if fields:
        set_clause = ", ".join(f"{k} = ?" for k in fields)
        values = [int(v) if isinstance(v, bool) else v for v in fields.values()]
        conn.execute(f"UPDATE books SET {set_clause} WHERE id = ?", (*values, book_id))
    return _row_to_book(_get_book_row(conn, book_id))


@router.delete("/{book_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_book(book_id: str, conn: sqlite3.Connection = Depends(get_db)) -> None:
    row = _get_book_row(conn, book_id)
    book_storage.delete_book_files(row["stored_path"], row["cover_path"])
    conn.execute("DELETE FROM books WHERE id = ?", (book_id,))


@router.post("/{book_id}/retry-ingest", status_code=status.HTTP_202_ACCEPTED, response_model=BookOut)
def retry_ingest(
    book_id: str, background_tasks: BackgroundTasks, conn: sqlite3.Connection = Depends(get_db)
) -> BookOut:
    row = _get_book_row(conn, book_id)
    if row["ingest_status"] != "failed":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only a failed book can be retried")
    conn.execute("UPDATE books SET ingest_status = 'queued', ingest_error = NULL WHERE id = ?", (book_id,))
    conn.commit()
    background_tasks.add_task(_run_ingest_in_background, book_id)
    return _row_to_book(_get_book_row(conn, book_id))
