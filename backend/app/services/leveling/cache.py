"""Read-through cache over `leveled_blocks` (spec §7.3).

Keyed by (text_hash, mode, target_cefr, engine) — by *content*, not by book. The
same paragraph in a second edition costs one generation, and the entry survives
deleting and re-importing the book. `engine` is in the key so a future LLM
result never collides with the rules result already stored for that paragraph.

Single-flight matters even for the rules engine, which is fast: double-clicking
a mode would otherwise run it twice and race two identical INSERTs.
"""

import json
import sqlite3
import threading

from app.services.leveling.base import EngineUnavailable, LeveledSegment, LeveledText, Mode
from app.utils.time import iso8601_utc_now

# One lock per cache key, held only across the generate-and-store window.
_locks: dict[tuple[str, str, str, str], threading.Lock] = {}
_locks_guard = threading.Lock()


def _lock_for(key: tuple[str, str, str, str]) -> threading.Lock:
    with _locks_guard:
        lock = _locks.get(key)
        if lock is None:
            lock = threading.Lock()
            _locks[key] = lock
        return lock


def _serialise(result: LeveledText) -> str:
    return json.dumps(
        {
            "original": result.original,
            "available": result.available,
            "note": result.note,
            "segments": [{"text": s.text, "original": s.original} for s in result.segments],
        }
    )


def _deserialise(
    payload: str, *, mode: str, target_cefr: str, engine: str
) -> LeveledText:
    data = json.loads(payload)
    return LeveledText(
        mode=mode,
        target_cefr=target_cefr,
        engine=engine,
        original=data["original"],
        segments=tuple(
            LeveledSegment(text=s["text"], original=s["original"]) for s in data["segments"]
        ),
        available=data.get("available", True),
        note=data.get("note"),
    )


def read(
    conn: sqlite3.Connection, *, text_hash: str, mode: str, target_cefr: str, engine: str
) -> LeveledText | None:
    row = conn.execute(
        """
        SELECT payload_json FROM leveled_blocks
        WHERE text_hash = ? AND mode = ? AND target_cefr = ? AND engine = ?
        """,
        (text_hash, mode, target_cefr, engine),
    ).fetchone()
    if row is None:
        return None
    return _deserialise(
        row["payload_json"], mode=mode, target_cefr=target_cefr, engine=engine
    )


def write(
    conn: sqlite3.Connection, *, text_hash: str, result: LeveledText
) -> None:
    conn.execute(
        """
        INSERT INTO leveled_blocks (text_hash, mode, target_cefr, engine, payload_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(text_hash, mode, target_cefr, engine) DO NOTHING
        """,
        (
            text_hash,
            result.mode,
            result.target_cefr,
            result.engine,
            _serialise(result),
            iso8601_utc_now(),
        ),
    )


def get_or_generate(
    conn: sqlite3.Connection,
    *,
    text: str,
    text_hash: str,
    mode: Mode,
    target_cefr: str,
    engine,
) -> tuple[LeveledText, bool]:
    """Returns (result, cached). Raises EngineUnavailable straight through —
    an unavailable mode is never cached, so configuring a model later doesn't
    have to invalidate anything.
    """
    key = (text_hash, mode, target_cefr, engine.name)

    hit = read(conn, text_hash=text_hash, mode=mode, target_cefr=target_cefr, engine=engine.name)
    if hit is not None:
        return hit, True

    with _lock_for(key):
        # Another request may have generated and stored it while we waited.
        hit = read(
            conn, text_hash=text_hash, mode=mode, target_cefr=target_cefr, engine=engine.name
        )
        if hit is not None:
            return hit, True

        result = engine.level(text, mode, target_cefr)
        write(conn, text_hash=text_hash, result=result)
        return result, False


__all__ = ["EngineUnavailable", "get_or_generate", "read", "write"]
