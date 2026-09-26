import json
import sqlite3
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from fastapi.responses import FileResponse

from app.db import get_connection, get_db
from app.models.books import (
    PageHeatOut,
    PageLabelCreate,
    PageLabelOut,
    PageTextLayerOut,
    PageWordHeatOut,
    PageWordOut,
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
    HighlightRect,
    PageHighlightCreate,
    PageHighlightOut,
    PageHighlightUpdate,
    BookmarkCreate,
    BookmarkOut,
    HighlightCreate,
    HighlightOut,
    HighlightUpdate,
)
from app.models.reading import SessionHeartbeat, SessionOpen, SessionOut
from app.models.search import SearchHitOut, SnippetSegmentOut
from app.security import require_token
from app.services import (
    book_search,
    book_storage,
    difficulty_heat,
    pagination,
    reader_level,
    reading_goal,
)
from app.services.ingest import pipeline
from app.utils.ids import uuid7
from app.utils.time import iso8601_utc_now

router = APIRouter(prefix="/books", dependencies=[Depends(require_token)])


def _row_to_book(row: sqlite3.Row) -> BookOut:
    # list_books joins the reader's position on; the import/patch paths select
    # from books alone and leave a book looking untouched, which it is.
    keys = row.keys()
    last_read_at = row["last_read_at"] if "last_read_at" in keys else None
    max_block_seen = row["max_block_seen"] if "max_block_seen" in keys else None
    return BookOut(
        percent=pagination.percent_complete(max_block_seen or 0, row["total_blocks"])
        if max_block_seen is not None
        else 0.0,
        last_read_at=last_read_at,
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
        has_page_images=row["format"] == "pdf",
    )


def _row_to_session(row: sqlite3.Row) -> SessionOut:
    return SessionOut(
        id=row["id"],
        book_id=row["book_id"],
        local_date=row["local_date"],
        words_read=row["words_read"],
        seconds=row["seconds"],
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
    select = """
        SELECT b.*, p.updated_at AS last_read_at, p.max_block_seen AS max_block_seen
        FROM books b
        LEFT JOIN reading_positions p ON p.book_id = b.id AND p.user_id = b.user_id
        WHERE b.user_id = ?
    """
    if status:
        rows = conn.execute(
            f"{select} AND b.ingest_status = ? ORDER BY b.imported_at DESC", (user_id, status)
        ).fetchall()
    else:
        rows = conn.execute(f"{select} ORDER BY b.imported_at DESC", (user_id,)).fetchall()
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


# Rendered at roughly 150dpi: sharp on a high-density display at the width a
# reader pane gives it, and small enough that a page arrives without a wait.
# The browser handles zoom from there, so nothing here is re-rendered for it.
_PAGE_RENDER_SCALE = 2.0


def _page_image_source(row: sqlite3.Row) -> Path:
    """The stored PDF a page can be rendered from, or 404.

    Only PDFs have pages to render. Everything else is reflowable — there is
    no original page to show, because the format never had one."""
    if row["format"] != "pdf":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Only PDFs have original pages to show.",
        )
    stored = row["stored_path"]
    if not stored or not Path(stored).is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="This book's file is missing."
        )
    return Path(stored)


@router.get("/{book_id}/page/{page}/image")
def get_page_image(
    book_id: str, page: int, conn: sqlite3.Connection = Depends(get_db)
) -> FileResponse:
    """The book's own page, as it was typeset.

    The text pipeline necessarily throws away everything that is not prose —
    figures, plates, equations set as images, the layout itself — so this is
    the only way to see what a page actually contained. Rendered on demand
    rather than at ingest: a 600-page book is 600 renders and most readers
    open a handful of them.
    """
    row = _get_book_row(conn, book_id)
    source = _page_image_source(row)
    if page < 1:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No such page")

    cached = book_storage.page_image_path(book_id, page)
    if cached.is_file():
        return FileResponse(cached, media_type="image/png")

    import fitz  # imported here so a non-PDF install never pays for it

    try:
        doc = fitz.open(str(source))
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="This book's file could not be opened."
        ) from exc
    try:
        if page > doc.page_count:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No such page")
        pixmap = doc.load_page(page - 1).get_pixmap(
            matrix=fitz.Matrix(_PAGE_RENDER_SCALE, _PAGE_RENDER_SCALE), alpha=False
        )
        # Written aside and moved into place, so that two readers asking for
        # the same page at once cannot serve each other half a file.
        partial = cached.with_suffix(f".{uuid7()}.part")
        partial.write_bytes(pixmap.tobytes("png"))
        partial.replace(cached)
    finally:
        doc.close()

    return FileResponse(cached, media_type="image/png")


@router.get("/{book_id}/page/{page}/text-layer", response_model=PageTextLayerOut)
def get_page_text_layer(
    book_id: str, page: int, conn: sqlite3.Connection = Depends(get_db)
) -> PageTextLayerOut:
    """Where every word on the rendered page is."""
    return _page_text_layer(conn, book_id, page)


def _page_text_layer(
    conn: sqlite3.Connection, book_id: str, page: int
) -> PageTextLayerOut:
    """The boxed words of one rendered page.

    The page image is a picture, so nothing on it can be selected, looked up
    or highlighted — which is why the reader had to tell people that those
    things "work in the text view". This is the missing half: the same words,
    boxed, in the image's own pixels, so the client can lay an invisible
    selectable layer over the picture. It is how every PDF viewer does it.

    Cached beside the image, because both are derived from the same page and
    a re-read of a page should not re-parse it.
    """
    row = _get_book_row(conn, book_id)
    source = _page_image_source(row)
    if page < 1:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No such page")

    cached = book_storage.page_text_layer_path(book_id, page)
    if cached.is_file():
        try:
            return PageTextLayerOut(**json.loads(cached.read_text()))
        except (json.JSONDecodeError, TypeError, ValueError):
            # A cache we can no longer read is a cache problem, not a reader
            # problem: fall through and rebuild it.
            cached.unlink(missing_ok=True)

    import fitz  # imported here so a non-PDF install never pays for it

    try:
        doc = fitz.open(str(source))
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="This book's file could not be opened."
        ) from exc
    try:
        if page > doc.page_count:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No such page")
        loaded = doc.load_page(page - 1)
        scale = _PAGE_RENDER_SCALE
        words = [
            PageWordOut(
                x=round(w[0] * scale, 2),
                y=round(w[1] * scale, 2),
                w=round((w[2] - w[0]) * scale, 2),
                h=round((w[3] - w[1]) * scale, 2),
                t=w[4],
                # PyMuPDF numbers lines within a block, so the pair is what
                # actually identifies a line on the page.
                ln=w[5] * 1000 + w[6],
            )
            # sort=True returns them in reading order, which is the order the
            # browser will join them in when a selection is copied. Unsorted,
            # a two-column page copies as one interleaved mess.
            for w in loaded.get_text("words", sort=True)
            if w[4].strip()
        ]
        layer = PageTextLayerOut(
            width=round(loaded.rect.width * scale, 2),
            height=round(loaded.rect.height * scale, 2),
            words=words,
        )
    finally:
        doc.close()

    partial = cached.with_suffix(f".{uuid7()}.part")
    partial.write_text(layer.model_dump_json())
    partial.replace(cached)
    return layer


@router.get("/{book_id}/page/{page}/heat", response_model=PageHeatOut)
def get_page_heat(
    book_id: str,
    page: int,
    user_id: str | None = None,
    target_cefr: str | None = None,
    conn: sqlite3.Connection = Depends(get_db),
) -> PageHeatOut:
    """Which words on a printed page are above the reader's level.

    Same lexicon and target as /reading/heat gives for a block; only the
    coordinates differ, because a page has boxes rather than character
    offsets.
    """
    row = _get_book_row(conn, book_id)
    try:
        resolved = reader_level.resolve_target(conn, user_id, target_cefr)
    except reader_level.UnknownBand as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    # Per-book opt-out, answered before the page is parsed: a book with the
    # overlay off should not pay to render a text layer nobody will tint.
    if not row["heat_overlay"]:
        return PageHeatOut(target_cefr=resolved, enabled=False, words=[], total_above_level=0)

    layer = _page_text_layer(conn, book_id, page)
    hot = difficulty_heat.above_level_boxes([w.t for w in layer.words], resolved)
    return PageHeatOut(
        target_cefr=resolved,
        enabled=True,
        words=[
            PageWordHeatOut(i=h.index, word=h.word, cefr=h.cefr, simpler=h.simpler) for h in hot
        ],
        total_above_level=len(hot),
    )


@router.get("/{book_id}/toc", response_model=list[ChapterOut])
def get_toc(book_id: str, conn: sqlite3.Connection = Depends(get_db)) -> list[ChapterOut]:
    book = _get_book_row(conn, book_id)
    rows = conn.execute(
        "SELECT * FROM book_chapters WHERE book_id = ? ORDER BY order_index", (book_id,)
    ).fetchall()
    native = _uses_native_pages(book)
    return [
        ChapterOut(
            id=row["id"],
            order_index=row["order_index"],
            label=row["label"],
            depth=row["depth"],
            start_block=row["start_block"],
            # A native-paged book's chapter starts on whatever page its first
            # block was printed on, not on a word-count estimate.
            page=(
                _block_page(conn, book, row["start_block"])
                if native
                else pagination.page_number(row["word_offset"])
            ),
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
    total_pages = _total_pages(conn, book)
    page = max(1, page)
    if total_pages:
        page = min(page, total_pages)

    if _uses_native_pages(book):
        # The document already told us which page each block was printed on.
        rows = conn.execute(
            "SELECT block_index, chapter_id, kind, text, word_count FROM book_blocks "
            "WHERE book_id = ? AND page_number = ? ORDER BY block_index",
            (book_id, page),
        ).fetchall()
    else:
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


def _uses_native_pages(book: sqlite3.Row) -> bool:
    """PDFs page by their own printed boundaries; reflowable formats derive a
    page from cumulative word counts (spec D3)."""
    keys = book.keys()
    return "uses_native_pages" in keys and bool(book["uses_native_pages"])


def _total_pages(conn: sqlite3.Connection, book: sqlite3.Row) -> int:
    if _uses_native_pages(book):
        # The document's own page count, recorded at ingest. Counting the
        # highest page that produced a block — which this did — loses every
        # page after the last one with prose on it, so a book ending in
        # plates simply stopped early and there was no way to reach them.
        stored = book["page_estimate"] or 0
        if stored:
            return stored
        row = conn.execute(
            "SELECT COALESCE(MAX(page_number), 0) AS p FROM book_blocks WHERE book_id = ?",
            (book["id"],),
        ).fetchone()
        return row["p"]
    return pagination.total_pages(book["total_words"])


@router.get("/{book_id}/position", response_model=PositionOut)
def get_position(book_id: str, user_id: str, conn: sqlite3.Connection = Depends(get_db)) -> PositionOut:
    book = _get_book_row(conn, book_id)
    row = conn.execute(
        "SELECT * FROM reading_positions WHERE book_id = ? AND user_id = ?", (book_id, user_id)
    ).fetchone()
    block_index = row["block_index"] if row else 0
    char_offset = row["char_offset"] if row else 0
    max_seen = row["max_block_seen"] if row else 0
    return PositionOut(
        block_index=block_index,
        char_offset=char_offset,
        max_block_seen=max_seen,
        page=_block_page(conn, book, block_index),
        total_pages=_total_pages(conn, book),
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

    # -1 rather than 0 for a first-ever open so block 0 itself gets credited.
    previous_max = existing["max_block_seen"] if existing else -1
    reading_goal.record_progress(
        conn,
        book_id=book_id,
        user_id=payload.user_id,
        previous_max_block=previous_max,
        new_max_block=max_seen,
    )

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


def _block_page(conn: sqlite3.Connection, book: sqlite3.Row, block_index: int) -> int:
    if _uses_native_pages(book):
        row = conn.execute(
            "SELECT page_number FROM book_blocks WHERE book_id = ? AND block_index = ?",
            (book["id"], block_index),
        ).fetchone()
        if row is not None and row["page_number"] is not None:
            return row["page_number"]
    return pagination.page_number(_word_offset_before(conn, book["id"], block_index))


def _row_to_highlight(conn: sqlite3.Connection, book: sqlite3.Row, row: sqlite3.Row) -> HighlightOut:
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
        page=_block_page(conn, book, row["block_index"]),
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
    book = _get_book_row(conn, book_id)
    rows = conn.execute(
        "SELECT * FROM book_highlights WHERE book_id = ? AND user_id = ? ORDER BY block_index, start_char",
        (book_id, user_id),
    ).fetchall()
    return [_row_to_highlight(conn, book, row) for row in rows]


# --------------------------------------------------------------------------
# Highlights drawn on the page as printed.
#
# Kept apart from the block-anchored ones above: see 0031_page_highlights.sql
# for why one table cannot honestly hold both.


def _row_to_page_highlight(row: sqlite3.Row) -> PageHighlightOut:
    return PageHighlightOut(
        id=row["id"],
        book_id=row["book_id"],
        user_id=row["user_id"],
        page=row["page"],
        rects=[HighlightRect(**r) for r in json.loads(row["rects"])],
        colour=row["colour"],
        style=row["style"],
        quoted_text=row["quoted_text"],
        note=row["note"],
        created_at=row["created_at"],
    )


@router.get("/{book_id}/page-highlights", response_model=list[PageHighlightOut])
def list_page_highlights(
    book_id: str, user_id: str, page: int | None = None, conn: sqlite3.Connection = Depends(get_db)
) -> list[PageHighlightOut]:
    """Every page highlight in the book, or just one page's.

    The reader asks per page while reading — a 938-page textbook's whole set
    is not worth sending to draw one page — and asks for all of them to fill
    the highlights panel.
    """
    _get_book_row(conn, book_id)
    sql = "SELECT * FROM book_page_highlights WHERE book_id = ? AND user_id = ?"
    args: list[object] = [book_id, user_id]
    if page is not None:
        sql += " AND page = ?"
        args.append(page)
    rows = conn.execute(sql + " ORDER BY page, created_at", args).fetchall()
    return [_row_to_page_highlight(row) for row in rows]


@router.post(
    "/{book_id}/page-highlights",
    response_model=PageHighlightOut,
    status_code=status.HTTP_201_CREATED,
)
def create_page_highlight(
    book_id: str, payload: PageHighlightCreate, conn: sqlite3.Connection = Depends(get_db)
) -> PageHighlightOut:
    row = _get_book_row(conn, book_id)
    # Only a PDF has a printed page to draw on. Refused here rather than
    # stored and silently never shown.
    _page_image_source(row)
    if payload.page < 1:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No such page")
    if not payload.rects:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A highlight needs at least one area to mark.",
        )

    highlight_id = uuid7()
    conn.execute(
        """
        INSERT INTO book_page_highlights
            (id, book_id, user_id, page, rects, colour, style, quoted_text, note, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            highlight_id,
            book_id,
            payload.user_id,
            payload.page,
            json.dumps([r.model_dump() for r in payload.rects]),
            payload.colour,
            payload.style,
            payload.quoted_text,
            payload.note,
            iso8601_utc_now(),
        ),
    )
    created = conn.execute(
        "SELECT * FROM book_page_highlights WHERE id = ?", (highlight_id,)
    ).fetchone()
    return _row_to_page_highlight(created)


@router.patch("/{book_id}/page-highlights/{highlight_id}", response_model=PageHighlightOut)
def update_page_highlight(
    book_id: str,
    highlight_id: str,
    payload: PageHighlightUpdate,
    conn: sqlite3.Connection = Depends(get_db),
) -> PageHighlightOut:
    row = conn.execute(
        "SELECT * FROM book_page_highlights WHERE id = ? AND book_id = ?", (highlight_id, book_id)
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Highlight not found")
    fields = payload.model_dump(exclude_unset=True)
    if fields:
        assignments = ", ".join(f"{name} = ?" for name in fields)
        conn.execute(
            f"UPDATE book_page_highlights SET {assignments} WHERE id = ?",
            (*fields.values(), highlight_id),
        )
        row = conn.execute(
            "SELECT * FROM book_page_highlights WHERE id = ?", (highlight_id,)
        ).fetchone()
    return _row_to_page_highlight(row)


@router.delete("/{book_id}/page-highlights/{highlight_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_page_highlight(
    book_id: str, highlight_id: str, conn: sqlite3.Connection = Depends(get_db)
) -> None:
    cur = conn.execute(
        "DELETE FROM book_page_highlights WHERE id = ? AND book_id = ?", (highlight_id, book_id)
    )
    if cur.rowcount == 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Highlight not found")


# --------------------------------------------------------------------------
# Plainer words pinned over the page. See 0032_page_labels.sql.


def _row_to_page_label(row: sqlite3.Row) -> PageLabelOut:
    return PageLabelOut(
        id=row["id"],
        book_id=row["book_id"],
        page=row["page"],
        rects=json.loads(row["rects"]),
        original_text=row["original_text"],
        simple_text=row["simple_text"],
        mode=row["mode"],
        created_at=row["created_at"],
    )


@router.get("/{book_id}/page-labels", response_model=list[PageLabelOut])
def list_page_labels(
    book_id: str, user_id: str, page: int | None = None, conn: sqlite3.Connection = Depends(get_db)
) -> list[PageLabelOut]:
    _get_book_row(conn, book_id)
    sql = "SELECT * FROM book_page_labels WHERE book_id = ? AND user_id = ?"
    args: list[object] = [book_id, user_id]
    if page is not None:
        sql += " AND page = ?"
        args.append(page)
    rows = conn.execute(sql + " ORDER BY page, created_at", args).fetchall()
    return [_row_to_page_label(row) for row in rows]


@router.post(
    "/{book_id}/page-labels", response_model=PageLabelOut, status_code=status.HTTP_201_CREATED
)
def create_page_label(
    book_id: str, payload: PageLabelCreate, conn: sqlite3.Connection = Depends(get_db)
) -> PageLabelOut:
    row = _get_book_row(conn, book_id)
    _page_image_source(row)
    if not payload.rects:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="There is nowhere on the page to put this.",
        )
    if not payload.simple_text.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="There are no simpler words to show.",
        )

    label_id = uuid7()
    conn.execute(
        """
        INSERT INTO book_page_labels
            (id, book_id, user_id, page, rects, original_text, simple_text, mode, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            label_id,
            book_id,
            payload.user_id,
            payload.page,
            json.dumps(payload.rects),
            payload.original_text,
            payload.simple_text,
            payload.mode,
            iso8601_utc_now(),
        ),
    )
    created = conn.execute("SELECT * FROM book_page_labels WHERE id = ?", (label_id,)).fetchone()
    return _row_to_page_label(created)


@router.delete("/{book_id}/page-labels/{label_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_page_label(
    book_id: str, label_id: str, conn: sqlite3.Connection = Depends(get_db)
) -> None:
    cur = conn.execute(
        "DELETE FROM book_page_labels WHERE id = ? AND book_id = ?", (label_id, book_id)
    )
    if cur.rowcount == 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")


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
    return _row_to_highlight(conn, book, _get_highlight_row(conn, book_id, highlight_id))


@router.patch("/{book_id}/highlights/{highlight_id}", response_model=HighlightOut)
def update_highlight(
    book_id: str, highlight_id: str, payload: HighlightUpdate, conn: sqlite3.Connection = Depends(get_db)
) -> HighlightOut:
    book = _get_book_row(conn, book_id)
    _get_highlight_row(conn, book_id, highlight_id)
    fields = payload.model_dump(exclude_unset=True)
    if fields:
        set_clause = ", ".join(f"{k} = ?" for k in fields)
        conn.execute(f"UPDATE book_highlights SET {set_clause} WHERE id = ?", (*fields.values(), highlight_id))
    return _row_to_highlight(conn, book, _get_highlight_row(conn, book_id, highlight_id))


@router.delete("/{book_id}/highlights/{highlight_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_highlight(book_id: str, highlight_id: str, conn: sqlite3.Connection = Depends(get_db)) -> None:
    _get_highlight_row(conn, book_id, highlight_id)
    conn.execute("DELETE FROM book_highlights WHERE id = ?", (highlight_id,))


def _row_to_bookmark(conn: sqlite3.Connection, book: sqlite3.Row, row: sqlite3.Row) -> BookmarkOut:
    return BookmarkOut(
        id=row["id"],
        book_id=row["book_id"],
        user_id=row["user_id"],
        block_index=row["block_index"],
        label=row["label"],
        created_at=row["created_at"],
        page=_block_page(conn, book, row["block_index"]),
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
    book = _get_book_row(conn, book_id)
    rows = conn.execute(
        "SELECT * FROM book_bookmarks WHERE book_id = ? AND user_id = ? ORDER BY block_index", (book_id, user_id)
    ).fetchall()
    return [_row_to_bookmark(conn, book, row) for row in rows]


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
    return _row_to_bookmark(conn, book, _get_bookmark_row(conn, book_id, bookmark_id))


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
    book = _get_book_row(conn, book_id)
    rows = book_search.search_book(conn, book_id, q, limit=limit)
    return [
        SearchHitOut(
            block_index=row["block_index"],
            page=_block_page(conn, book, row["block_index"]),
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
    row = _get_book_row(conn, book_id)
    fields = payload.model_dump(exclude_unset=True)

    # `finished` is a bool on the wire but a timestamp in the column, so it
    # can't go through the generic SET below.
    finished = fields.pop("finished", None)
    if finished is not None:
        if not finished:
            conn.execute("UPDATE books SET finished_at = NULL WHERE id = ?", (book_id,))
        elif row["finished_at"] is None:
            # Re-marking an already-finished book keeps the original date —
            # when you finished it is a fact, not something a stray click
            # should move.
            conn.execute(
                "UPDATE books SET finished_at = ? WHERE id = ?", (iso8601_utc_now(), book_id)
            )

    if fields:
        set_clause = ", ".join(f"{k} = ?" for k in fields)
        values = [int(v) if isinstance(v, bool) else v for v in fields.values()]
        conn.execute(f"UPDATE books SET {set_clause} WHERE id = ?", (*values, book_id))
    return _row_to_book(_get_book_row(conn, book_id))


@router.delete("/{book_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_book(book_id: str, conn: sqlite3.Connection = Depends(get_db)) -> None:
    row = _get_book_row(conn, book_id)
    book_storage.delete_book_files(row["stored_path"], row["cover_path"], book_id)
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


@router.post("/{book_id}/sessions", response_model=SessionOut, status_code=status.HTTP_201_CREATED)
def open_session(
    book_id: str, payload: SessionOpen, conn: sqlite3.Connection = Depends(get_db)
) -> SessionOut:
    """Opened when the reader mounts. Idempotent per day, so reopening a book
    four times in an evening keeps adding to one row instead of fragmenting
    the day's reading across four."""
    _get_book_row(conn, book_id)
    row = reading_goal.open_session(conn, book_id=book_id, user_id=payload.user_id)
    return _row_to_session(row)


@router.patch("/{book_id}/sessions/{session_id}", response_model=SessionOut)
def heartbeat_session(
    book_id: str,
    session_id: str,
    payload: SessionHeartbeat,
    conn: sqlite3.Connection = Depends(get_db),
) -> SessionOut:
    _get_book_row(conn, book_id)
    row = reading_goal.add_seconds(conn, session_id=session_id, seconds=payload.seconds)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    return _row_to_session(row)
