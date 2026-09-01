import sqlite3
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from fastapi.responses import FileResponse

from app.db import get_connection, get_db
from app.models.books import BookCountsOut, BookImportRequest, BookOut, BookUpdate
from app.security import require_token
from app.services import book_storage
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
    # No reading_positions rows are written until Phase 2, so "reading" is
    # always 0 for now and every ready, unfinished book counts as not-started.
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
