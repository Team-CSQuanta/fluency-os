"""Generated subtitle tracks.

The Whisper call itself is one line inside stt_engine.transcribe_file; what
this covers is the part around it that can actually be wrong — batching cues
in as they arrive, reporting progress, honouring a cancel, and never letting a
half-finished run masquerade as a complete track.

The model is stubbed rather than downloaded: a real transcription would make
the suite depend on a 75 MB download and several minutes of CPU to test
bookkeeping that has nothing to do with acoustics.
"""

import sqlite3
from pathlib import Path

import pytest

from app.db import get_connection
from app.migrations.runner import run_migrations
from app.services.media import tracks
from app.services.voice import stt_engine
from app.utils.ids import uuid7
from app.utils.time import iso8601_utc_now


@pytest.fixture()
def conn(tmp_path) -> sqlite3.Connection:
    connection = get_connection(str(tmp_path / "gen.db"))
    run_migrations(connection)
    user_id = uuid7()
    connection.execute(
        "INSERT INTO users (id, display_name, native_language, target_language, created_at) VALUES (?,?,?,?,?)",
        (user_id, "Watcher", "bn", "en", iso8601_utc_now()),
    )
    connection.execute(
        "INSERT INTO media_items (id, user_id, title, kind, source_path, file_hash, duration_ms, added_at) "
        "VALUES ('m1', ?, 'Film', 'local', '/tmp/film.mkv', 'h1', 60000, ?)",
        (user_id, iso8601_utc_now()),
    )
    connection.commit()
    yield connection
    connection.close()


def _new_track(conn: sqlite3.Connection) -> str:
    return tracks.create_track(
        conn,
        media_item_id="m1",
        kind="subtitle",
        origin="generated",
        language="en",
        label="generated · whisper",
        status="queued",
    )


def _stub(monkeypatch, segments, *, cancel_after=None):
    """Stands in for transcribe_file, driving the same callbacks."""

    def fake(path, *, on_segment, on_progress=None, should_cancel=None, language="en"):
        emitted = 0
        for i, (start, end, text) in enumerate(segments):
            if should_cancel is not None and should_cancel():
                break
            on_segment(start, end, text)
            emitted += 1
            if on_progress:
                on_progress((i + 1) / len(segments))
            if cancel_after is not None and emitted == cancel_after:
                tracks.request_cancel(cancel_after_track[0])
        return emitted

    cancel_after_track = [None]
    monkeypatch.setattr(stt_engine, "transcribe_file", fake)
    return cancel_after_track


def test_generated_cues_are_written_in_order_and_the_track_goes_ready(conn, monkeypatch):
    segments = [(i * 2000, i * 2000 + 1500, f"Line {i}") for i in range(60)]
    _stub(monkeypatch, segments)
    track_id = _new_track(conn)

    written = tracks.generate_track(conn, track_id=track_id, video_path=Path("/tmp/film.mkv"))

    assert written == 60
    rows = conn.execute(
        "SELECT order_index, start_ms, text FROM media_cues WHERE track_id = ? ORDER BY order_index", (track_id,)
    ).fetchall()
    assert [r["order_index"] for r in rows] == list(range(60))
    assert rows[0]["text"] == "Line 0"
    assert rows[59]["start_ms"] == 118_000

    track = conn.execute("SELECT * FROM media_tracks WHERE id = ?", (track_id,)).fetchone()
    assert track["status"] == "ready"
    assert track["cue_count"] == 60
    assert track["progress"] == 1


def test_cues_are_committed_as_they_arrive_not_only_at_the_end(conn, monkeypatch):
    """A two-hour film must produce a usable track while it is still running,
    and must not lose twenty minutes of work to a crash at minute twenty."""
    seen: list[int] = []

    def fake(path, *, on_segment, on_progress=None, should_cancel=None, language="en"):
        for i in range(80):
            on_segment(i * 1000, i * 1000 + 800, f"L{i}")
            other = get_connection(conn.execute("PRAGMA database_list").fetchone()[2])
            seen.append(
                other.execute(
                    "SELECT COUNT(*) AS c FROM media_cues WHERE track_id = ?", (track_id,)
                ).fetchone()["c"]
            )
            other.close()
        return 80

    monkeypatch.setattr(stt_engine, "transcribe_file", fake)
    track_id = _new_track(conn)
    conn.commit()

    tracks.generate_track(conn, track_id=track_id, video_path=Path("/tmp/film.mkv"))

    # Another connection saw cues appear mid-run, not all at once at the end.
    assert max(seen) >= 25
    assert seen[-1] >= 75


def test_a_cancelled_run_keeps_its_cues_but_says_it_is_incomplete(conn, monkeypatch):
    track_id = _new_track(conn)

    def fake(path, *, on_segment, on_progress=None, should_cancel=None, language="en"):
        for i in range(100):
            if should_cancel():
                return i
            on_segment(i * 1000, i * 1000 + 800, f"L{i}")
            if i == 29:
                tracks.request_cancel(track_id)
        return 100

    monkeypatch.setattr(stt_engine, "transcribe_file", fake)
    tracks.generate_track(conn, track_id=track_id, video_path=Path("/tmp/film.mkv"))

    track = conn.execute("SELECT * FROM media_tracks WHERE id = ?", (track_id,)).fetchone()
    assert track["status"] == "ready"
    assert "only the start" in (track["error"] or "")
    assert conn.execute(
        "SELECT COUNT(*) AS c FROM media_cues WHERE track_id = ?", (track_id,)
    ).fetchone()["c"] == 30


def test_regenerating_replaces_rather_than_appends(conn, monkeypatch):
    """A second attempt after a bad first one must not interleave the two."""
    track_id = _new_track(conn)
    _stub(monkeypatch, [(0, 500, "first attempt")])
    tracks.generate_track(conn, track_id=track_id, video_path=Path("/tmp/film.mkv"))

    _stub(monkeypatch, [(0, 500, "second attempt"), (1000, 1500, "and more")])
    tracks.generate_track(conn, track_id=track_id, video_path=Path("/tmp/film.mkv"))

    rows = conn.execute(
        "SELECT text FROM media_cues WHERE track_id = ? ORDER BY order_index", (track_id,)
    ).fetchall()
    assert [r["text"] for r in rows] == ["second attempt", "and more"]


def test_only_one_generation_runs_at_a_time(conn, monkeypatch):
    """Two Whisper models on this hardware tier is an out-of-memory kill, not
    a slowdown — so the second request must be refused, not queued."""
    from app.services.voice.errors import EngineUnavailable

    track_a = _new_track(conn)
    track_b = _new_track(conn)
    conn.commit()

    def fake(path, *, on_segment, on_progress=None, should_cancel=None, language="en"):
        assert tracks.generation_busy()
        with pytest.raises(EngineUnavailable):
            tracks.generate_track(conn, track_id=track_b, video_path=Path("/tmp/film.mkv"))
        on_segment(0, 500, "only one")
        return 1

    monkeypatch.setattr(stt_engine, "transcribe_file", fake)
    tracks.generate_track(conn, track_id=track_a, video_path=Path("/tmp/film.mkv"))
    assert not tracks.generation_busy()


def test_the_lock_is_released_even_when_transcription_raises(conn, monkeypatch):
    """Otherwise one failure means no subtitles can ever be generated again
    without restarting the app."""

    def fake(path, **kwargs):
        raise RuntimeError("model exploded")

    monkeypatch.setattr(stt_engine, "transcribe_file", fake)
    track_id = _new_track(conn)

    with pytest.raises(RuntimeError):
        tracks.generate_track(conn, track_id=track_id, video_path=Path("/tmp/film.mkv"))
    assert not tracks.generation_busy()
