import sqlite3
from typing import Iterator

from app.config import settings


def get_connection(db_path: str | None = None) -> sqlite3.Connection:
    # FastAPI opens a sync generator dependency and runs the endpoint on
    # different threadpool threads, so a per-request connection legitimately
    # moves between threads. It is still never used by two threads at once.
    conn = sqlite3.connect(db_path or settings.db_path, check_same_thread=False)
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.row_factory = sqlite3.Row
    return conn


def get_db() -> Iterator[sqlite3.Connection]:
    """FastAPI dependency: one connection per request, committed on success."""
    conn = get_connection()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
