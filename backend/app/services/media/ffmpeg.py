"""Locating and running ffmpeg/ffprobe.

Spec §3.3 lists ffmpeg as bundled. It isn't bundled yet, so this resolves in
the order a real install will want anyway: an explicit override, then the
binary sitting next to the app's data directory (where a future bundling step
would drop it), then PATH. Everything downstream treats a missing binary as a
first-class state — FfmpegUnavailable — rather than crashing, because a user
whose distro ships no ffmpeg should be told that, not shown a stack trace.
"""

import json
import os
import shutil
import subprocess
from pathlib import Path

from app.services import book_storage


class FfmpegUnavailable(Exception):
    """ffmpeg/ffprobe could not be found or could not be run."""


class FfmpegFailed(Exception):
    """The binary ran and exited non-zero. Carries the tail of its stderr,
    which is the only part that ever says anything useful."""


def _candidates(name: str) -> list[Path]:
    found: list[Path] = []
    override = os.environ.get("FLUENCYOS_FFMPEG_DIR")
    if override:
        found.append(Path(override) / name)
    found.append(Path(book_storage._data_dir()) / "bin" / name)
    on_path = shutil.which(name)
    if on_path:
        found.append(Path(on_path))
    return found


def _resolve(name: str) -> Path:
    for candidate in _candidates(name):
        if candidate.is_file() and os.access(candidate, os.X_OK):
            return candidate
    raise FfmpegUnavailable(
        f"{name} was not found. Install ffmpeg and restart FluencyOS, or set FLUENCYOS_FFMPEG_DIR."
    )


def ffmpeg_path() -> Path:
    return _resolve("ffmpeg")


def ffprobe_path() -> Path:
    return _resolve("ffprobe")


def is_available() -> bool:
    try:
        ffmpeg_path()
        ffprobe_path()
    except FfmpegUnavailable:
        return False
    return True


def version() -> str | None:
    """First line of `ffmpeg -version`, for Settings to show what it found."""
    try:
        out = run([str(ffmpeg_path()), "-version"], timeout=10)
    except (FfmpegUnavailable, FfmpegFailed):
        return None
    return out.splitlines()[0].strip() if out else None


def run(argv: list[str], *, timeout: float = 300.0) -> str:
    """Run a binary, returning stdout. Raises FfmpegFailed with the stderr
    tail on a non-zero exit."""
    try:
        proc = subprocess.run(  # noqa: S603 — argv built here, never shell-interpolated
            argv,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except FileNotFoundError as err:
        raise FfmpegUnavailable(str(err)) from err
    except subprocess.TimeoutExpired as err:
        raise FfmpegFailed(f"{Path(argv[0]).name} timed out after {timeout:.0f}s") from err
    if proc.returncode != 0:
        tail = "\n".join((proc.stderr or "").strip().splitlines()[-6:])
        raise FfmpegFailed(tail or f"{Path(argv[0]).name} exited {proc.returncode}")
    return proc.stdout


def probe_json(path: Path, *, timeout: float = 60.0) -> dict:
    out = run(
        [
            str(ffprobe_path()),
            "-v", "error",
            "-print_format", "json",
            "-show_format",
            "-show_streams",
            str(path),
        ],
        timeout=timeout,
    )
    try:
        return json.loads(out)
    except json.JSONDecodeError as err:
        raise FfmpegFailed("ffprobe returned output that wasn't JSON") from err
