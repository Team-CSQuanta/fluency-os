"""Where the watching feature's generated files live.

Sibling directories of the database file, same convention (and the same
reasoning) as book_storage. Note what is *not* here: the video itself. Source
files stay where the user keeps them — see 0017_media.sql.
"""

from pathlib import Path

from app.services import book_storage


def _dir(name: str) -> Path:
    d = book_storage._data_dir() / name
    d.mkdir(parents=True, exist_ok=True)
    return d


def thumbs_dir() -> Path:
    return _dir("media-thumbs")


def clips_dir() -> Path:
    return _dir("clips")


def subtitles_dir() -> Path:
    """Extracted embedded tracks and imported sidecars, normalised to UTF-8
    WebVTT. Cues are also stored in SQLite; the file is kept so a track can be
    re-parsed after a schema change without re-demuxing the source."""
    return _dir("subtitles")


def clip_paths(clip_id: str) -> tuple[Path, Path]:
    return clips_dir() / f"{clip_id}.mp4", clips_dir() / f"{clip_id}.jpg"


def library_bytes() -> int:
    """Total on-disk size of everything this feature generated — the spec's
    "library size indicator" (§4.2 storage policy)."""
    total = 0
    for d in (thumbs_dir(), clips_dir(), subtitles_dir()):
        for p in d.glob("*"):
            try:
                total += p.stat().st_size
            except OSError:
                continue
    return total


def delete_files(*paths: str | None) -> None:
    for p in paths:
        if not p:
            continue
        try:
            Path(p).unlink(missing_ok=True)
        except OSError:
            pass
