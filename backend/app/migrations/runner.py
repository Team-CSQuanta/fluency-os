import sqlite3
from pathlib import Path

from app.utils.ids import uuid7
from app.utils.time import iso8601_utc_now

MIGRATIONS_DIR = Path(__file__).parent


def _migration_files() -> list[Path]:
    return sorted(MIGRATIONS_DIR.glob("*.sql"))


def run_migrations(conn: sqlite3.Connection) -> None:
    conn.execute(
        "CREATE TABLE IF NOT EXISTS _migrations (filename TEXT PRIMARY KEY, applied_at TEXT NOT NULL)"
    )

    applied = {row["filename"] for row in conn.execute("SELECT filename FROM _migrations")}

    for path in _migration_files():
        if path.name in applied:
            continue
        sql = path.read_text()
        conn.executescript(sql)
        conn.execute(
            "INSERT INTO _migrations (filename, applied_at) VALUES (?, ?)",
            (path.name, iso8601_utc_now()),
        )

    latest = _migration_files()[-1].stem.split("_")[0] if _migration_files() else "0"
    conn.execute(
        "INSERT INTO app_meta (key, value) VALUES ('schema_version', ?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (latest,),
    )
    conn.execute(
        "INSERT OR IGNORE INTO app_meta (key, value) VALUES ('install_id', ?)",
        (uuid7(),),
    )
    conn.execute("INSERT OR IGNORE INTO app_meta (key, value) VALUES ('last_backup_at', NULL)")
    conn.commit()
