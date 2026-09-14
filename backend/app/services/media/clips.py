"""The Clip Context Engine (spec §4.2).

When a word is saved while watching, cut the moment it was said and keep it,
so the entry can later be re-experienced rather than merely re-read. This is
the subsystem the spec calls distinguishing, and the part a learner notices.

The window maths is a pure function (`window_for`) so the awkward cases —
a cue at the very start of the file, a cue butted against its neighbour, a
forty-second monologue that has to be capped — are testable without ffmpeg.
"""

import sqlite3
from dataclasses import dataclass
from pathlib import Path

from app.services.media import ffmpeg, storage
from app.utils.ids import uuid7
from app.utils.time import iso8601_utc_now

# Seek this far ahead of the target before decoding. Input seeking lands on a
# keyframe, which may be several seconds before the requested time; decoding
# from there and trimming on the output gives frame-accurate starts at a
# fraction of the cost of decoding the file from zero.
_PREROLL_MS = 5000


@dataclass(frozen=True)
class ClipWindow:
    start_ms: int
    end_ms: int

    @property
    def duration_ms(self) -> int:
        return self.end_ms - self.start_ms


def window_for(
    *,
    cue_start_ms: int,
    cue_end_ms: int,
    pad_before_ms: int,
    pad_after_ms: int,
    max_ms: int,
    duration_ms: int,
    prev_cue_end_ms: int | None = None,
    next_cue_start_ms: int | None = None,
) -> ClipWindow:
    """Spec §4.2 steps 1-3.

    Clamping to neighbouring cues is what stops a clip opening on the tail of
    the previous line — which, for a learner reviewing the card later, reads
    as the wrong sentence rather than as generous padding.

    The 10 s cap trims from the *end*: the cue's opening is the part that was
    being looked up, so a long line should lose its tail, not its head.
    """
    start = cue_start_ms - max(0, pad_before_ms)
    if prev_cue_end_ms is not None:
        start = max(start, prev_cue_end_ms)
    start = max(0, start)

    end = cue_end_ms + max(0, pad_after_ms)
    if next_cue_start_ms is not None:
        end = min(end, next_cue_start_ms)
    if duration_ms > 0:
        end = min(end, duration_ms)

    # A cue whose neighbours leave no room at all still has to produce a
    # playable clip, so the cue's own span wins over the clamp.
    if end <= start:
        start, end = max(0, cue_start_ms), max(cue_start_ms + 1, cue_end_ms)
        if duration_ms > 0:
            end = min(end, duration_ms)

    if max_ms > 0 and end - start > max_ms:
        end = start + max_ms

    return ClipWindow(start_ms=start, end_ms=end)


def neighbours(conn: sqlite3.Connection, track_id: str, order_index: int) -> tuple[int | None, int | None]:
    prev_row = conn.execute(
        "SELECT end_ms FROM media_cues WHERE track_id = ? AND order_index = ?", (track_id, order_index - 1)
    ).fetchone()
    next_row = conn.execute(
        "SELECT start_ms FROM media_cues WHERE track_id = ? AND order_index = ?", (track_id, order_index + 1)
    ).fetchone()
    return (prev_row["end_ms"] if prev_row else None, next_row["start_ms"] if next_row else None)


def extract(
    *,
    source: Path,
    window: ClipWindow,
    clip_path: Path,
    thumb_path: Path,
    height: int = 480,
) -> tuple[int, bool]:
    """Spec §4.2 steps 4-5. Returns (clip_bytes, thumbnail_written).

    H.264 + AAC at `height` so a library of hundreds of clips stays small
    enough to live beside the app; `-movflags +faststart` so the renderer's
    <video> can begin playing before the whole file has arrived.
    """
    coarse_ms = max(0, window.start_ms - _PREROLL_MS)
    fine_s = (window.start_ms - coarse_ms) / 1000
    duration_s = max(0.1, window.duration_ms / 1000)

    ffmpeg.run(
        [
            str(ffmpeg.ffmpeg_path()),
            "-hide_banner", "-loglevel", "error",
            "-ss", f"{coarse_ms / 1000:.3f}",
            "-i", str(source),
            "-ss", f"{fine_s:.3f}",
            "-t", f"{duration_s:.3f}",
            "-vf", f"scale=-2:min({height}\\,ih)",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "24",
            "-c:a", "aac", "-b:a", "128k",
            "-movflags", "+faststart",
            "-y", str(clip_path),
        ],
        timeout=300,
    )

    thumb_ok = True
    try:
        ffmpeg.run(
            [
                str(ffmpeg.ffmpeg_path()),
                "-hide_banner", "-loglevel", "error",
                "-ss", f"{window.duration_ms / 2000:.3f}",
                "-i", str(clip_path),
                "-frames:v", "1", "-q:v", "4",
                "-y", str(thumb_path),
            ],
            timeout=60,
        )
    except ffmpeg.FfmpegFailed:
        # A clip shorter than a single frame interval has no midpoint frame.
        # Worth keeping the clip: the card falls back to the video itself.
        thumb_ok = False

    return (clip_path.stat().st_size if clip_path.is_file() else 0), thumb_ok


def queue(
    conn: sqlite3.Connection,
    *,
    media_item_id: str,
    vocab_word_id: str | None,
    vocab_context_id: str | None,
    cue_text: str,
    window: ClipWindow,
    store_file: bool,
) -> str:
    """Record the clip row before any extraction runs.

    Written first, and committed by the caller before the background task
    starts, for the reason spec §4.1.3 gives: saving a word must never block
    playback. The learner's save is durable the instant it is pressed; the
    video file is an optimisation that arrives later or not at all.
    """
    clip_id = uuid7()
    conn.execute(
        """
        INSERT INTO media_clips (id, media_item_id, vocab_word_id, vocab_context_id, cue_text,
                                 start_ms, end_ms, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            clip_id,
            media_item_id,
            vocab_word_id,
            vocab_context_id,
            cue_text,
            window.start_ms,
            window.end_ms,
            "queued" if store_file else "virtual",
            iso8601_utc_now(),
        ),
    )
    return clip_id


def run_job(conn: sqlite3.Connection, clip_id: str, *, height: int = 480) -> None:
    """Extract one queued clip. Never raises: a failed extraction is a state
    the card renders (spec §4.2 "Fallback"), not an error anyone can act on
    mid-playback."""
    row = conn.execute(
        """
        SELECT c.*, m.source_path, m.source_missing
        FROM media_clips c JOIN media_items m ON m.id = c.media_item_id
        WHERE c.id = ?
        """,
        (clip_id,),
    ).fetchone()
    if row is None or row["status"] != "queued":
        return

    source = Path(row["source_path"]) if row["source_path"] else None
    if source is None or not source.is_file():
        conn.execute(
            "UPDATE media_clips SET status = 'failed', error = ? WHERE id = ?",
            ("The source file has moved — relink it to rebuild this clip.", clip_id),
        )
        conn.commit()
        return

    clip_path, thumb_path = storage.clip_paths(clip_id)
    conn.execute("UPDATE media_clips SET status = 'extracting' WHERE id = ?", (clip_id,))
    conn.commit()

    try:
        size, thumb_ok = extract(
            source=source,
            window=ClipWindow(start_ms=row["start_ms"], end_ms=row["end_ms"]),
            clip_path=clip_path,
            thumb_path=thumb_path,
            height=height,
        )
    except (ffmpeg.FfmpegUnavailable, ffmpeg.FfmpegFailed) as err:
        storage.delete_files(str(clip_path), str(thumb_path))
        conn.execute("UPDATE media_clips SET status = 'failed', error = ? WHERE id = ?", (str(err)[:500], clip_id))
        conn.commit()
        return

    conn.execute(
        "UPDATE media_clips SET status = 'ready', clip_path = ?, thumb_path = ?, clip_bytes = ?, error = NULL "
        "WHERE id = ?",
        (str(clip_path), str(thumb_path) if thumb_ok else None, size, clip_id),
    )
    conn.commit()
