from pathlib import Path

from app.config import settings
from app.db import get_connection
from app.migrations.runner import run_migrations
from app.services import book_storage
from app.services.ingest import pipeline
from app.utils.ids import uuid7


def _fresh_conn(tmp_path):
    settings.db_path = str(tmp_path / "pipeline_test.db")
    conn = get_connection()
    run_migrations(conn)
    # users FK must exist for books.user_id
    conn.execute(
        "INSERT INTO users (id, display_name, native_language, target_language, created_at) "
        "VALUES ('u1', 'Test User', 'en', 'en', '2026-01-01T00:00:00Z')"
    )
    conn.commit()
    return conn


def test_ingest_txt_book_end_to_end(tmp_path):
    conn = _fresh_conn(tmp_path)
    source = tmp_path / "source" / "My Book.txt"
    source.parent.mkdir()
    source.write_text("Paragraph one.\n\nParagraph two is here.", encoding="utf-8")

    book_id = uuid7()
    file_hash = pipeline.compute_file_hash(source)
    stored_path = book_storage.store_book_file(source, book_id)
    pipeline.create_queued_book(
        conn,
        book_id=book_id,
        user_id="u1",
        source_path=source,
        stored_path=stored_path,
        file_hash=file_hash,
        file_bytes=source.stat().st_size,
        fmt="txt",
        count_toward_goal=True,
        heat_overlay=True,
    )
    conn.commit()

    pipeline.ingest_book(conn, book_id)

    row = conn.execute("SELECT * FROM books WHERE id = ?", (book_id,)).fetchone()
    assert row["ingest_status"] == "ready"
    assert row["ingest_error"] is None
    assert row["total_blocks"] == 2
    assert row["total_words"] == 6

    blocks = conn.execute(
        "SELECT * FROM book_blocks WHERE book_id = ? ORDER BY block_index", (book_id,)
    ).fetchall()
    assert [b["text"] for b in blocks] == ["Paragraph one.", "Paragraph two is here."]

    fts_rows = conn.execute("SELECT text FROM book_blocks_fts WHERE book_id = ?", (book_id,)).fetchall()
    assert len(fts_rows) == 2
    conn.close()


def test_reimport_same_file_is_a_noop(tmp_path):
    conn = _fresh_conn(tmp_path)
    source = tmp_path / "dup.txt"
    source.write_text("Some content.", encoding="utf-8")

    file_hash = pipeline.compute_file_hash(source)
    assert pipeline.find_existing_book(conn, "u1", file_hash) is None

    book_id = uuid7()
    stored_path = book_storage.store_book_file(source, book_id)
    pipeline.create_queued_book(
        conn,
        book_id=book_id,
        user_id="u1",
        source_path=source,
        stored_path=stored_path,
        file_hash=file_hash,
        file_bytes=source.stat().st_size,
        fmt="txt",
        count_toward_goal=True,
        heat_overlay=True,
    )
    conn.commit()

    existing = pipeline.find_existing_book(conn, "u1", file_hash)
    assert existing is not None
    assert existing["id"] == book_id
    conn.close()


def test_unsupported_format_fails_cleanly_with_no_orphan_blocks(tmp_path):
    conn = _fresh_conn(tmp_path)
    source = tmp_path / "book.pdf"
    source.write_bytes(b"%PDF-1.4 fake")

    book_id = uuid7()
    file_hash = pipeline.compute_file_hash(source)
    stored_path = book_storage.store_book_file(source, book_id)
    pipeline.create_queued_book(
        conn,
        book_id=book_id,
        user_id="u1",
        source_path=source,
        stored_path=stored_path,
        file_hash=file_hash,
        file_bytes=source.stat().st_size,
        fmt="pdf",
        count_toward_goal=True,
        heat_overlay=True,
    )
    conn.commit()

    pipeline.ingest_book(conn, book_id)

    row = conn.execute("SELECT * FROM books WHERE id = ?", (book_id,)).fetchone()
    assert row["ingest_status"] == "failed"
    assert row["ingest_error"]

    blocks = conn.execute("SELECT COUNT(*) AS c FROM book_blocks WHERE book_id = ?", (book_id,)).fetchone()
    assert blocks["c"] == 0
    conn.close()


def test_corrupt_txt_fails_without_orphan_rows(tmp_path):
    conn = _fresh_conn(tmp_path)
    source = tmp_path / "empty.txt"
    source.write_text("", encoding="utf-8")

    book_id = uuid7()
    file_hash = pipeline.compute_file_hash(source)
    stored_path = book_storage.store_book_file(source, book_id)
    pipeline.create_queued_book(
        conn,
        book_id=book_id,
        user_id="u1",
        source_path=source,
        stored_path=stored_path,
        file_hash=file_hash,
        file_bytes=source.stat().st_size,
        fmt="txt",
        count_toward_goal=True,
        heat_overlay=True,
    )
    conn.commit()

    pipeline.ingest_book(conn, book_id)

    row = conn.execute("SELECT * FROM books WHERE id = ?", (book_id,)).fetchone()
    assert row["ingest_status"] == "failed"
    assert row["ingest_error"]
    conn.close()


def test_delete_removes_stored_file(tmp_path):
    conn = _fresh_conn(tmp_path)
    source = tmp_path / "to_delete.txt"
    source.write_text("Content.", encoding="utf-8")

    book_id = uuid7()
    stored_path = book_storage.store_book_file(source, book_id)
    assert stored_path.is_file()

    book_storage.delete_book_files(str(stored_path), None)
    assert not stored_path.is_file()
    conn.close()
