"""Moving an MP4's seek index to the front of the file.

A file whose `moov` box follows its `mdat` cannot be seeked without first
reading the end of the file. On a 1.2 GB film that is the difference between
scrubbing and waiting, and it is a property of the file rather than of this
player — the same file is slow in any of them.

The repair is a remux, not a re-encode: the audio and video streams are copied
byte for byte and only the box order changes. It is lossless and runs at disk
speed. It does, however, rewrite a file the learner owns, so nothing here
happens without an explicit request, and the original is only replaced once
the replacement has been checked.
"""

import os
import shutil
import sqlite3
from dataclasses import dataclass
from pathlib import Path

from app.services.media import ffmpeg, probe as probe_mod

# The remux is written beside the original so the final step can be an atomic
# rename; a temp directory would usually be a different filesystem, where
# os.replace falls back to a copy and stops being atomic. The original
# extension is kept: ffmpeg chooses its muxer from it, and a name ending
# ".tmp" leaves it unable to tell an MP4 from a MOV.
_TEMP_MARKER = ".fluencyos-faststart"
# Duration must survive the remux. A stream copy should be exact; this tolerance
# only absorbs container rounding.
_DURATION_TOLERANCE_S = 1.0


class OptimizeError(Exception):
    """The remux could not be completed. The original is always untouched."""


@dataclass(frozen=True)
class OptimizeResult:
    bytes_before: int
    bytes_after: int
    duration_s: float


def _free_bytes(path: Path) -> int:
    return shutil.disk_usage(path.parent).free


def remux_faststart(source: Path) -> OptimizeResult:
    """Rewrite `source` in place with its index first. Raises OptimizeError,
    having removed any partial output, if anything looks wrong."""
    if not source.is_file():
        raise OptimizeError("The source file is no longer where FluencyOS left it.")

    original_size = source.stat().st_size
    # The remux is a full second copy before the rename, so the space has to
    # be there. A little headroom over the exact size for container overhead.
    if _free_bytes(source) < original_size * 1.05:
        raise OptimizeError(
            f"Not enough free disk space — this needs about {original_size / 1e9:.1f} GB "
            "free on the same drive as the file."
        )

    before = probe_mod.probe(source)
    temp = source.with_name(f"{source.stem}{_TEMP_MARKER}{source.suffix}")

    try:
        ffmpeg.run(
            [
                str(ffmpeg.ffmpeg_path()),
                "-hide_banner", "-loglevel", "error",
                "-i", str(source),
                "-map", "0",
                "-c", "copy",
                # Keep subtitle and data streams the container already carries.
                "-movflags", "+faststart",
                "-y", str(temp),
            ],
            timeout=3600,
        )
    except (ffmpeg.FfmpegUnavailable, ffmpeg.FfmpegFailed) as err:
        temp.unlink(missing_ok=True)
        raise OptimizeError(str(err)) from err

    # Verify before replacing anything. A truncated or stream-dropping remux
    # that silently overwrote the original would be the worst outcome here.
    try:
        after = probe_mod.probe(temp)
    except (ffmpeg.FfmpegUnavailable, ffmpeg.FfmpegFailed) as err:
        temp.unlink(missing_ok=True)
        raise OptimizeError(f"The rewritten file could not be read back: {err}") from err

    problems = []
    if abs(after.duration_ms - before.duration_ms) > _DURATION_TOLERANCE_S * 1000:
        problems.append(f"duration changed ({before.duration_ms} ms to {after.duration_ms} ms)")
    if after.video_codec != before.video_codec or after.audio_codec != before.audio_codec:
        problems.append("streams changed")
    if len(after.subtitles) < len(before.subtitles):
        problems.append("subtitle tracks were lost")
    if probe_mod.index_at_end(temp):
        problems.append("the index is still at the end")
    if temp.stat().st_size < original_size * 0.9:
        problems.append("the output is unexpectedly small")

    if problems:
        temp.unlink(missing_ok=True)
        raise OptimizeError("The rewritten file failed its check — " + "; ".join(problems))

    new_size = temp.stat().st_size
    # Carry the original's permissions across; os.replace is atomic within a
    # filesystem, so there is no window where neither file exists.
    try:
        shutil.copymode(source, temp)
        os.replace(temp, source)
    except OSError as err:
        temp.unlink(missing_ok=True)
        raise OptimizeError(f"Could not replace the original file: {err}") from err

    return OptimizeResult(bytes_before=original_size, bytes_after=new_size, duration_s=after.duration_ms / 1000)


def run_job(conn: sqlite3.Connection, media_id: str) -> None:
    """Remux one library item, recording the outcome on its row."""
    row = conn.execute("SELECT * FROM media_items WHERE id = ?", (media_id,)).fetchone()
    if row is None or not row["source_path"]:
        return
    source = Path(row["source_path"])

    conn.execute("UPDATE media_items SET ingest_status = 'probing', ingest_error = NULL WHERE id = ?", (media_id,))
    conn.commit()
    try:
        remux_faststart(source)
    except OptimizeError as err:
        conn.execute(
            "UPDATE media_items SET ingest_status = 'ready', ingest_error = ? WHERE id = ?",
            (str(err)[:500], media_id),
        )
        conn.commit()
        return

    # The file changed, so its identity and its measurements did too.
    conn.execute(
        "UPDATE media_items SET index_at_end = 0, ingest_status = 'ready', ingest_error = NULL, "
        "file_bytes = ?, file_hash = ? WHERE id = ?",
        (source.stat().st_size, probe_mod.quick_hash(source), media_id),
    )
    conn.commit()
