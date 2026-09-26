"""Reading a video file's shape with ffprobe, and identifying it cheaply.

Two things the library needs before it can show a card: what the file *is*
(duration, resolution, codecs, which tracks it carries) and whether we have
already imported it.
"""

import hashlib
from dataclasses import dataclass
from pathlib import Path

from app.services.media import ffmpeg, storage

VIDEO_SUFFIXES = {".mp4", ".mkv", ".avi", ".webm", ".mov", ".m4v", ".mpg", ".mpeg", ".wmv", ".flv", ".ts"}

# Subtitle codecs ffmpeg can turn into text. Bitmap formats (PGS on Blu-ray
# rips, VOBSUB on DVD rips) are images of subtitles and would need OCR, so
# they are listed as tracks but cannot be converted into clickable cues.
TEXT_SUBTITLE_CODECS = {"subrip", "srt", "ass", "ssa", "webvtt", "mov_text", "text", "eia_608", "subviewer"}

_HASH_CHUNK = 1024 * 1024


@dataclass(frozen=True)
class SubtitleStream:
    index: int
    codec: str
    language: str | None
    title: str | None
    is_text: bool
    forced: bool


@dataclass(frozen=True)
class AudioStream:
    index: int
    codec: str
    language: str | None
    title: str | None
    channels: int | None


@dataclass(frozen=True)
class MediaProbe:
    duration_ms: int
    width: int | None
    height: int | None
    video_codec: str | None
    audio_codec: str | None
    container: str | None
    subtitles: tuple[SubtitleStream, ...]
    audios: tuple[AudioStream, ...]


def quick_hash(path: Path) -> str:
    """Identity for a video file: size plus the first and last megabyte.

    Hashing a 20 GB MKV end-to-end takes minutes and buys nothing here — this
    exists only to notice "you already imported this", and two distinct films
    do not share a size *and* both boundary megabytes. Cheap enough to run
    inline during import, which whole-file hashing is not.
    """
    size = path.stat().st_size
    digest = hashlib.sha256()
    digest.update(str(size).encode("ascii"))
    with path.open("rb") as fh:
        digest.update(fh.read(_HASH_CHUNK))
        if size > _HASH_CHUNK * 2:
            fh.seek(-_HASH_CHUNK, 2)
            digest.update(fh.read(_HASH_CHUNK))
    return digest.hexdigest()


def _lang(tags: dict) -> str | None:
    raw = (tags.get("language") or "").strip().lower()
    # ffprobe reports "und" for an untagged track; that is not a language and
    # showing it as one would put "und" in the track picker.
    return None if raw in ("", "und", "unknown") else raw


def _duration_ms(payload: dict) -> int:
    fmt = payload.get("format") or {}
    raw = fmt.get("duration")
    if raw is None:
        # Some MKVs carry duration on the video stream only.
        for stream in payload.get("streams", []):
            if stream.get("codec_type") == "video" and stream.get("duration"):
                raw = stream["duration"]
                break
    try:
        return max(0, int(round(float(raw) * 1000)))
    except (TypeError, ValueError):
        return 0


def probe(path: Path) -> MediaProbe:
    payload = ffmpeg.probe_json(path)
    streams = payload.get("streams", [])

    video = next((s for s in streams if s.get("codec_type") == "video"), None)
    audio = next((s for s in streams if s.get("codec_type") == "audio"), None)

    subtitles: list[SubtitleStream] = []
    audios: list[AudioStream] = []
    for stream in streams:
        kind = stream.get("codec_type")
        tags = stream.get("tags") or {}
        if kind == "subtitle":
            codec = (stream.get("codec_name") or "").lower()
            subtitles.append(
                SubtitleStream(
                    index=int(stream.get("index", 0)),
                    codec=codec,
                    language=_lang(tags),
                    title=(tags.get("title") or "").strip() or None,
                    is_text=codec in TEXT_SUBTITLE_CODECS,
                    forced=bool((stream.get("disposition") or {}).get("forced")),
                )
            )
        elif kind == "audio":
            audios.append(
                AudioStream(
                    index=int(stream.get("index", 0)),
                    codec=(stream.get("codec_name") or "").lower(),
                    language=_lang(tags),
                    title=(tags.get("title") or "").strip() or None,
                    channels=stream.get("channels"),
                )
            )

    fmt = payload.get("format") or {}
    container = (fmt.get("format_name") or "").split(",")[0] or None

    return MediaProbe(
        duration_ms=_duration_ms(payload),
        width=video.get("width") if video else None,
        height=video.get("height") if video else None,
        video_codec=(video.get("codec_name") if video else None),
        audio_codec=(audio.get("codec_name") if audio else None),
        container=container,
        subtitles=tuple(subtitles),
        audios=tuple(audios),
    )


def extract_thumbnail(path: Path, media_id: str, *, at_ms: int, height: int = 240) -> Path | None:
    """A single frame for the library card.

    Seeks with -ss *before* -i (input seeking: jumps via the index instead of
    decoding up to the point) — on a two-hour film that is the difference
    between milliseconds and half a minute.
    """
    dest = storage.thumbs_dir() / f"{media_id}.jpg"
    try:
        ffmpeg.run(
            [
                str(ffmpeg.ffmpeg_path()),
                "-hide_banner", "-loglevel", "error",
                "-ss", f"{max(0, at_ms) / 1000:.3f}",
                "-i", str(path),
                "-frames:v", "1",
                "-vf", f"scale=-2:{height}",
                "-q:v", "4",
                "-y", str(dest),
            ],
            timeout=60,
        )
    except (ffmpeg.FfmpegUnavailable, ffmpeg.FfmpegFailed):
        return None
    return dest if dest.is_file() and dest.stat().st_size > 0 else None


# MP4-family brands whose seek index ("moov") can sit at either end of the file.
_MP4_SUFFIXES = {".mp4", ".m4v", ".mov"}
_BOX_HEADER = 8


def index_at_end(path: Path) -> bool:
    """True when an MP4's `moov` box follows the media data.

    This is the single biggest cause of slow seeking in a large file, and it
    is invisible until you try. The `moov` box is the index: without it the
    player cannot map a timestamp to a byte offset. When it sits after `mdat`,
    seeking anywhere in a 1.2 GB film means fetching and parsing the tail of
    that film first — every time the buffer is cold.

    Reading a handful of box headers costs a few disk seeks, so this runs
    during ingest rather than being something the user has to discover.

    Returns False for anything that is not an MP4-family file: MKV and WebM
    keep their cues elsewhere, and the question does not apply.
    """
    if path.suffix.lower() not in _MP4_SUFFIXES:
        return False
    try:
        size = path.stat().st_size
        with path.open("rb") as fh:
            offset = 0
            seen_mdat = False
            for _ in range(24):
                if offset >= size:
                    break
                fh.seek(offset)
                header = fh.read(16)
                if len(header) < _BOX_HEADER:
                    break
                box_size = int.from_bytes(header[:4], "big")
                name = header[4:8].decode("latin-1", "replace")
                if box_size == 1:
                    if len(header) < 16:
                        break
                    box_size = int.from_bytes(header[8:16], "big")
                elif box_size == 0:
                    # Runs to end of file: nothing can follow it.
                    return name != "moov" and seen_mdat
                if box_size < _BOX_HEADER:
                    break
                if name == "moov":
                    return seen_mdat
                if name == "mdat":
                    seen_mdat = True
                offset += box_size
    except OSError:
        return False
    return False
