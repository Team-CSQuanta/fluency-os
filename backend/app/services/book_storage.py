"""Resolves where imported book files and covers live on disk.

There's no existing "userData" config value in Settings (see config.py) —
the app already colocates its SQLite file with the rest of its data, so
books/ and covers/ are resolved as siblings of the database file rather than
adding a new CLI flag that would also need threading through Electron's
backend-process.ts.
"""

import shutil
from pathlib import Path

from app.config import settings


def _data_dir() -> Path:
    return Path(settings.db_path).resolve().parent


def books_dir() -> Path:
    d = _data_dir() / "books"
    d.mkdir(parents=True, exist_ok=True)
    return d


def covers_dir() -> Path:
    d = _data_dir() / "covers"
    d.mkdir(parents=True, exist_ok=True)
    return d


def store_book_file(source_path: Path, book_id: str) -> Path:
    """Copies the source file into books/<id>.<ext>, returns the new path."""
    ext = source_path.suffix.lstrip(".").lower()
    dest = books_dir() / f"{book_id}.{ext}"
    shutil.copyfile(source_path, dest)
    return dest


def store_cover(cover_bytes: bytes, book_id: str, ext: str) -> Path:
    dest = covers_dir() / f"{book_id}.{ext}"
    dest.write_bytes(cover_bytes)
    return dest


def delete_book_files(stored_path: str | None, cover_path: str | None) -> None:
    for p in (stored_path, cover_path):
        if not p:
            continue
        try:
            Path(p).unlink(missing_ok=True)
        except OSError:
            pass
