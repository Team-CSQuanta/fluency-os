"""Reading long media as fixed-size audio windows.

faster-whisper's own loader decodes a whole file into RAM before the model
sees a single frame: it fills an in-memory s16 buffer, then converts it to
float32 with both copies alive at once. Measured on a two-hour film that peaks
at 1,162 MB for a 461 MB array — more than this app's whole hardware tier can
spare once Electron, the backend and the model are resident, which is why
transcribing a movie killed the application.

A window is read straight from the source with ffmpeg and costs the same
whether the film is ten minutes or four hours.
"""

import subprocess
from pathlib import Path

import numpy as np

SAMPLE_RATE = 16000
# Seek coarsely to a keyframe before the target, then trim precisely on the
# output — the same trick clips.py uses. Input seeking alone lands on a frame
# boundary, and the error would accumulate across windows into timestamp drift.
_PREROLL_S = 2.0


def read_window(path: Path, start_s: float, duration_s: float) -> np.ndarray:
    """Mono 16 kHz float32 samples for [start_s, start_s + duration_s).

    Returns a shorter array at end of file, and an empty one past it — which
    is how the caller detects EOF without needing the duration up front.
    """
    from app.services.media import ffmpeg  # local: the mic path needs no ffmpeg

    coarse = max(0.0, start_s - _PREROLL_S)
    fine = start_s - coarse

    argv = [
        str(ffmpeg.ffmpeg_path()),
        "-hide_banner", "-loglevel", "error",
        "-ss", f"{coarse:.3f}",
        "-i", str(path),
        "-ss", f"{fine:.3f}",
        "-t", f"{duration_s:.3f}",
        "-vn",
        "-map", "0:a:0",
        "-f", "s16le",
        "-acodec", "pcm_s16le",
        "-ac", "1",
        "-ar", str(SAMPLE_RATE),
        "-",
    ]
    try:
        proc = subprocess.run(argv, capture_output=True, check=False, timeout=300)  # noqa: S603
    except subprocess.TimeoutExpired:
        return np.empty(0, dtype=np.float32)

    if proc.returncode != 0 or not proc.stdout:
        return np.empty(0, dtype=np.float32)

    # frombuffer is a view; the astype is the only copy, and it is one window
    # long rather than one film long.
    return np.frombuffer(proc.stdout, dtype=np.int16).astype(np.float32) / 32768.0


def duration_seconds(path: Path) -> float:
    """Total length, for progress reporting only — the window loop itself
    stops on EOF and does not depend on this being right."""
    from app.services.media import ffmpeg

    try:
        payload = ffmpeg.probe_json(path)
    except (ffmpeg.FfmpegUnavailable, ffmpeg.FfmpegFailed):
        return 0.0
    try:
        return float((payload.get("format") or {}).get("duration") or 0.0)
    except (TypeError, ValueError):
        return 0.0
