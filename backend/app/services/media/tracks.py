"""Subtitle tracks: discovering them, extracting them, generating them.

Three origins, and the difference between them is load-bearing rather than
cosmetic (spec §4.1.2):

  embedded   a track muxed into the file — demuxed with ffmpeg
  sidecar    a .srt/.vtt/.ass the user picked, or one found beside the video
  generated  produced here by Whisper, and labelled as such forever

A generated track is a machine's guess. Presenting it as equal to a published
one would mean a learner memorising a mis-transcription with no way to know.
"""

import re
import sqlite3
import threading
from pathlib import Path

from app.services.media import ffmpeg, probe as probe_mod, storage, subtitles
from app.services.voice import stt_engine
from app.services.voice.errors import EngineUnavailable
from app.utils.ids import uuid7
from app.utils.time import iso8601_utc_now

# Only one Whisper job at a time — see stt_engine.transcribe_file for why a
# second would be an OOM rather than a queue.
_generation_lock = threading.Lock()
_cancelled: set[str] = set()
_cancel_lock = threading.Lock()

SIDECAR_SUFFIXES = (".srt", ".vtt", ".ass", ".ssa")

# "Movie.2016.en.srt", "Movie.2016.en.forced.srt", "Movie (2016).eng.srt"
_LANG_IN_NAME = re.compile(r"[._-]([a-z]{2,3})(?:[._-](?:forced|sdh|cc|hi))?$", re.IGNORECASE)


def _now() -> str:
    return iso8601_utc_now()


def label_for(*, origin: str, language: str | None, title: str | None, index: int | None) -> str:
    """What the track picker shows. Built from whatever the file actually
    carries rather than a fixed template, because a track tagged only
    "Signs & Songs" is more useful to a learner than "Subtitle 3 · und"."""
    bits: list[str] = []
    if title:
        bits.append(title)
    if language:
        bits.append(language)
    if not bits:
        bits.append(f"track {index}" if index is not None else "subtitles")
    prefix = {"embedded": "embedded", "sidecar": "sidecar", "generated": "generated"}[origin]
    return f"{prefix} · {' · '.join(bits)}"


def create_track(
    conn: sqlite3.Connection,
    *,
    media_item_id: str,
    kind: str,
    origin: str,
    language: str | None,
    label: str,
    stream_index: int | None = None,
    source_path: str | None = None,
    role: str = "target",
    status: str = "ready",
) -> str:
    track_id = uuid7()
    conn.execute(
        """
        INSERT INTO media_tracks (id, media_item_id, kind, origin, language, label,
                                  stream_index, source_path, role, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (track_id, media_item_id, kind, origin, language, label, stream_index, source_path, role, status, _now()),
    )
    return track_id


def replace_cues(conn: sqlite3.Connection, track_id: str, cues: list[subtitles.Cue]) -> int:
    """Cues for a track, written as one transaction-visible set.

    Replaces rather than appends: re-extracting a track after a failed attempt
    must not leave the first attempt's partial cues interleaved with the
    second's, which is exactly what an append would produce.
    """
    conn.execute("DELETE FROM media_cues WHERE track_id = ?", (track_id,))
    conn.executemany(
        "INSERT INTO media_cues (id, track_id, order_index, start_ms, end_ms, text) VALUES (?, ?, ?, ?, ?, ?)",
        [(uuid7(), track_id, i, c.start_ms, c.end_ms, c.text) for i, c in enumerate(cues)],
    )
    conn.execute("UPDATE media_tracks SET cue_count = ?, status = 'ready' WHERE id = ?", (len(cues), track_id))
    return len(cues)


def set_failed(conn: sqlite3.Connection, track_id: str, message: str) -> None:
    conn.execute("UPDATE media_tracks SET status = 'failed', error = ? WHERE id = ?", (message[:500], track_id))


def register_streams(conn: sqlite3.Connection, media_item_id: str, info: probe_mod.MediaProbe) -> None:
    """Record every track the container declares, before any is extracted.

    Bitmap subtitle streams (PGS/VOBSUB) are registered too, marked failed
    with a reason. Hiding them would be worse: a learner who can see the track
    in VLC needs to be told why it is not clickable here, not left to assume
    the import lost it.
    """
    for stream in info.audios:
        create_track(
            conn,
            media_item_id=media_item_id,
            kind="audio",
            origin="embedded",
            language=stream.language,
            label=label_for(origin="embedded", language=stream.language, title=stream.title, index=stream.index),
            stream_index=stream.index,
        )

    for stream in info.subtitles:
        track_id = create_track(
            conn,
            media_item_id=media_item_id,
            kind="subtitle",
            origin="embedded",
            language=stream.language,
            label=label_for(origin="embedded", language=stream.language, title=stream.title, index=stream.index),
            stream_index=stream.index,
            status="queued" if stream.is_text else "failed",
        )
        if not stream.is_text:
            conn.execute(
                "UPDATE media_tracks SET error = ? WHERE id = ?",
                (
                    f"{stream.codec.upper()} is a picture-based subtitle format — "
                    "it can be played but not turned into clickable words.",
                    track_id,
                ),
            )


def find_sidecars(video_path: Path) -> list[Path]:
    """Subtitle files sitting beside the video, matched on stem.

    Matches "Film.srt", "Film.en.srt" and "Film.en.forced.srt" but not
    "OtherFilm.srt" or "Film 2.srt".

    Two rules, and the second is the one that matters: the stem must be
    followed by a separator, *and* what follows must not be a bare number.
    Without that, "Film 2.srt" — the subtitles for the sequel, sitting in the
    same folder — is silently attached to "Film", and the learner gets a track
    that drifts further out of sync the longer they watch.
    """
    stem = video_path.stem
    found: list[Path] = []
    try:
        siblings = sorted(video_path.parent.iterdir())
    except OSError:
        return []
    for candidate in siblings:
        if candidate.suffix.lower() not in SIDECAR_SUFFIXES or not candidate.is_file():
            continue
        name = candidate.stem
        if name == stem:
            found.append(candidate)
            continue
        if not name.startswith(stem) or name[len(stem) : len(stem) + 1] not in (".", "_", "-", " "):
            continue
        remainder = name[len(stem) + 1 :]
        if remainder and not remainder.replace(".", "").replace("-", "").replace("_", "").isdigit():
            found.append(candidate)
    return found


def language_from_filename(path: Path) -> str | None:
    match = _LANG_IN_NAME.search(path.stem)
    if match is None:
        return None
    code = match.group(1).lower()
    # Guard against a stem whose last segment merely looks like a code:
    # "Film.part1" would otherwise register as language "art".
    return code if code.isalpha() else None


def extract_embedded(conn: sqlite3.Connection, track_row: sqlite3.Row, video_path: Path) -> int:
    """Demux one embedded text subtitle stream into cues.

    `-map 0:<index>` rather than `-map 0:s:<n>`: the absolute stream index is
    what ffprobe reported, and the two numberings diverge on any file whose
    subtitle streams are not contiguous.
    """
    dest = storage.subtitles_dir() / f"{track_row['id']}.vtt"
    conn.execute("UPDATE media_tracks SET status = 'extracting', error = NULL WHERE id = ?", (track_row["id"],))
    conn.commit()
    ffmpeg.run(
        [
            str(ffmpeg.ffmpeg_path()),
            "-hide_banner", "-loglevel", "error",
            "-i", str(video_path),
            "-map", f"0:{track_row['stream_index']}",
            "-c:s", "webvtt",
            "-f", "webvtt",
            "-y", str(dest),
        ],
        timeout=600,
    )
    cues = subtitles.parse(dest.read_bytes(), suffix=".vtt")
    conn.execute("UPDATE media_tracks SET source_path = ? WHERE id = ?", (str(dest), track_row["id"]))
    return replace_cues(conn, track_row["id"], cues)


def import_sidecar(
    conn: sqlite3.Connection,
    *,
    media_item_id: str,
    path: Path,
    role: str = "target",
    language: str | None = None,
) -> tuple[str, int]:
    """Parse an external subtitle file into a track. Returns (track_id, cues)."""
    cues = subtitles.parse(path.read_bytes(), suffix=path.suffix)
    lang = language or language_from_filename(path)
    track_id = create_track(
        conn,
        media_item_id=media_item_id,
        kind="subtitle",
        origin="sidecar",
        language=lang,
        label=label_for(origin="sidecar", language=lang, title=path.name, index=None),
        source_path=str(path),
        role=role,
    )
    # Keep a normalised UTF-8 copy: the original may be cp1252 on a drive the
    # user later disconnects, and re-decoding it then is not possible.
    copy = storage.subtitles_dir() / f"{track_id}.vtt"
    copy.write_text(subtitles.to_vtt(cues), encoding="utf-8")
    conn.execute("UPDATE media_tracks SET source_path = ? WHERE id = ?", (str(copy), track_id))
    return track_id, replace_cues(conn, track_id, cues)


def request_cancel(track_id: str) -> None:
    with _cancel_lock:
        _cancelled.add(track_id)


def _is_cancelled(track_id: str) -> bool:
    with _cancel_lock:
        return track_id in _cancelled


def _clear_cancel(track_id: str) -> None:
    with _cancel_lock:
        _cancelled.discard(track_id)


def generation_busy() -> bool:
    return _generation_lock.locked()


def generate_track(conn: sqlite3.Connection, *, track_id: str, video_path: Path) -> int:
    """Whisper a file into a `generated` subtitle track.

    Cues are committed in batches as they arrive rather than at the end, so
    the player can start using the front of a long film while the back is
    still being transcribed, and so a crash twenty minutes in loses twenty
    seconds of work rather than twenty minutes.
    """
    if not _generation_lock.acquire(blocking=False):
        raise EngineUnavailable("Another subtitle track is being generated — wait for it to finish.")

    _clear_cancel(track_id)
    pending: list[tuple] = []
    written = 0

    def flush() -> None:
        nonlocal written
        if not pending:
            return
        conn.executemany(
            "INSERT INTO media_cues (id, track_id, order_index, start_ms, end_ms, text) VALUES (?, ?, ?, ?, ?, ?)",
            pending,
        )
        written += len(pending)
        pending.clear()
        conn.execute("UPDATE media_tracks SET cue_count = ? WHERE id = ?", (written, track_id))
        conn.commit()

    def on_segment(start_ms: int, end_ms: int, text: str) -> None:
        pending.append((uuid7(), track_id, written + len(pending), start_ms, end_ms, text))
        if len(pending) >= 25:
            flush()

    def on_progress(fraction: float) -> None:
        conn.execute("UPDATE media_tracks SET progress = ? WHERE id = ?", (round(fraction, 4), track_id))
        conn.commit()

    try:
        conn.execute(
            "UPDATE media_tracks SET status = 'transcribing', error = NULL, progress = 0 WHERE id = ?", (track_id,)
        )
        conn.execute("DELETE FROM media_cues WHERE track_id = ?", (track_id,))
        conn.commit()
        stt_engine.transcribe_file(
            str(video_path),
            on_segment=on_segment,
            on_progress=on_progress,
            should_cancel=lambda: _is_cancelled(track_id),
        )
        flush()
        if _is_cancelled(track_id):
            # A cancelled run keeps what it decoded — those cues are as good
            # as any other, they just stop partway — but must not claim to be
            # a complete track.
            conn.execute(
                "UPDATE media_tracks SET status = 'ready', error = ? WHERE id = ?",
                ("Stopped early — this track covers only the start of the file.", track_id),
            )
        else:
            conn.execute("UPDATE media_tracks SET status = 'ready', progress = 1 WHERE id = ?", (track_id,))
        conn.commit()
        return written
    finally:
        _clear_cancel(track_id)
        _generation_lock.release()
