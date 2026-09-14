"""Moving an MP4's seek index to the front.

A file whose `moov` box follows `mdat` cannot be seeked without reading the
end of the file first, which on a gigabyte-scale film is the difference
between scrubbing and waiting. The repair rewrites a file the learner owns, so
what matters most here is that it never damages one: every failure path must
leave the original exactly as it was.
"""

import subprocess
from pathlib import Path

import pytest

from app.services.media import ffmpeg, optimize, probe

pytestmark = pytest.mark.skipif(not ffmpeg.is_available(), reason="ffmpeg/ffprobe not installed")


def _make(path: Path, *, faststart: bool, seconds: int = 6) -> Path:
    argv = [
        str(ffmpeg.ffmpeg_path()), "-hide_banner", "-loglevel", "error",
        "-f", "lavfi", "-i", f"testsrc=size=240x135:rate=12:duration={seconds}",
        "-f", "lavfi", "-i", f"sine=frequency=300:duration={seconds}",
        "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac",
    ]
    if faststart:
        argv += ["-movflags", "+faststart"]
    argv += ["-y", str(path)]
    subprocess.run(argv, check=True, capture_output=True)
    return path


def test_a_plain_mp4_is_detected_as_having_its_index_at_the_end(tmp_path):
    assert probe.index_at_end(_make(tmp_path / "slow.mp4", faststart=False)) is True


def test_a_faststart_mp4_is_not_flagged(tmp_path):
    assert probe.index_at_end(_make(tmp_path / "quick.mp4", faststart=True)) is False


def test_matroska_is_never_flagged(tmp_path):
    """MKV keeps its cues elsewhere; the question does not apply and offering
    to rewrite the file would be nonsense."""
    mkv = tmp_path / "film.mkv"
    subprocess.run(
        [
            str(ffmpeg.ffmpeg_path()), "-hide_banner", "-loglevel", "error",
            "-f", "lavfi", "-i", "testsrc=size=240x135:rate=12:duration=3",
            "-c:v", "libx264", "-preset", "ultrafast", "-y", str(mkv),
        ],
        check=True, capture_output=True,
    )
    assert probe.index_at_end(mkv) is False


def test_a_missing_or_unreadable_file_is_not_flagged(tmp_path):
    assert probe.index_at_end(tmp_path / "gone.mp4") is False
    junk = tmp_path / "junk.mp4"
    junk.write_bytes(b"not an mp4 at all")
    assert probe.index_at_end(junk) is False


def test_remux_moves_the_index_without_touching_the_streams(tmp_path):
    source = _make(tmp_path / "slow.mp4", faststart=False)
    before = probe.probe(source)
    assert probe.index_at_end(source) is True

    result = optimize.remux_faststart(source)

    assert probe.index_at_end(source) is False
    after = probe.probe(source)
    assert after.video_codec == before.video_codec
    assert after.audio_codec == before.audio_codec
    assert abs(after.duration_ms - before.duration_ms) < 1000
    assert (after.width, after.height) == (before.width, before.height)
    assert result.bytes_after > 0


def test_it_is_a_remux_not_a_re_encode(tmp_path):
    """A re-encode would change the picture and take minutes on a film. The
    file size barely moves because the streams are copied byte for byte."""
    source = _make(tmp_path / "slow.mp4", faststart=False, seconds=8)
    before_size = source.stat().st_size
    optimize.remux_faststart(source)
    assert abs(source.stat().st_size - before_size) < before_size * 0.05


def test_no_temporary_file_is_left_behind(tmp_path):
    source = _make(tmp_path / "slow.mp4", faststart=False)
    optimize.remux_faststart(source)
    assert [p.name for p in tmp_path.iterdir()] == ["slow.mp4"]


def test_a_failed_remux_leaves_the_original_untouched(tmp_path, monkeypatch):
    """The property that matters most: this rewrites the learner's own file."""
    source = _make(tmp_path / "slow.mp4", faststart=False)
    original = source.read_bytes()

    real_run = ffmpeg.run

    def explode(argv, **kwargs):
        # Only the remux — probe() goes through ffmpeg.run too, and this must
        # not stand in for ffprobe.
        if "-movflags" not in argv:
            return real_run(argv, **kwargs)
        # Simulate ffmpeg dying partway, having written a partial output.
        Path(argv[argv.index("-y") + 1]).write_bytes(b"partial garbage")
        raise ffmpeg.FfmpegFailed("disk full")

    monkeypatch.setattr(ffmpeg, "run", explode)
    with pytest.raises(optimize.OptimizeError):
        optimize.remux_faststart(source)

    assert source.read_bytes() == original
    assert [p.name for p in tmp_path.iterdir()] == ["slow.mp4"]


def test_a_remux_that_loses_the_audio_is_rejected(tmp_path, monkeypatch):
    """Verification runs before the original is replaced, so a bad rewrite is
    thrown away rather than written over the film."""
    source = _make(tmp_path / "slow.mp4", faststart=False)
    original = source.read_bytes()
    real_run = ffmpeg.run

    def drop_audio(argv, **kwargs):
        if "-movflags" not in argv:
            return real_run(argv, **kwargs)
        stripped = [a for a in argv if a not in ("-map", "0")]
        index = stripped.index("-c")
        stripped[index:index + 2] = ["-an", "-c:v", "copy"]
        return real_run(stripped, **kwargs)

    monkeypatch.setattr(ffmpeg, "run", drop_audio)
    with pytest.raises(optimize.OptimizeError, match="streams changed"):
        optimize.remux_faststart(source)

    assert source.read_bytes() == original


def test_it_refuses_when_the_disk_could_not_hold_a_second_copy(tmp_path, monkeypatch):
    source = _make(tmp_path / "slow.mp4", faststart=False)
    original = source.read_bytes()
    monkeypatch.setattr(optimize, "_free_bytes", lambda path: 1024)

    with pytest.raises(optimize.OptimizeError, match="free disk space"):
        optimize.remux_faststart(source)
    assert source.read_bytes() == original


def test_backfill_flags_files_imported_before_the_column_existed(tmp_path):
    """Otherwise the fix is invisible for exactly the large old files that
    need it — the flag is only written during ingest."""
    import sqlite3

    from app.db import get_connection
    from app.migrations.runner import run_migrations
    from app.services.media import library
    from app.utils.time import iso8601_utc_now

    conn: sqlite3.Connection = get_connection(str(tmp_path / "lib.db"))
    run_migrations(conn)
    conn.execute(
        "INSERT INTO users (id, display_name, native_language, target_language, created_at) VALUES (?,?,?,?,?)",
        ("u1", "W", "bn", "en", iso8601_utc_now()),
    )
    slow = _make(tmp_path / "old.mp4", faststart=False)
    quick = _make(tmp_path / "fine.mp4", faststart=True)
    for ident, path in (("m-slow", slow), ("m-fine", quick)):
        conn.execute(
            "INSERT INTO media_items (id, user_id, title, kind, source_path, file_hash, added_at) "
            "VALUES (?, 'u1', ?, 'local', ?, ?, ?)",
            (ident, path.stem, str(path), ident, iso8601_utc_now()),
        )
    # A file on a drive that is not plugged in must not be flagged.
    conn.execute(
        "INSERT INTO media_items (id, user_id, title, kind, source_path, file_hash, added_at) "
        "VALUES ('m-gone', 'u1', 'gone', 'local', ?, 'h3', ?)",
        (str(tmp_path / "absent.mp4"), iso8601_utc_now()),
    )
    conn.commit()

    assert library.backfill_index_at_end(conn) == 1
    flags = {r["id"]: r["index_at_end"] for r in conn.execute("SELECT id, index_at_end FROM media_items")}
    assert flags == {"m-slow": 1, "m-fine": 0, "m-gone": 0}

    # Runs once: a second launch does no work.
    assert library.backfill_index_at_end(conn) == 0
    conn.close()
