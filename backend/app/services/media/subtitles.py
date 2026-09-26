"""Subtitle parsing: SRT, WebVTT and ASS/SSA.

Pure text in, cues out — no I/O beyond reading the bytes, so the whole format
surface is unit-testable without a video file anywhere near it.

Three formats rather than one because that is what people actually have:
sidecar files from the internet are nearly always .srt, ASS is what anime and
most fansubbed material ships, and WebVTT is what ffmpeg emits when we ask it
to convert an embedded track.
"""

import re
from dataclasses import dataclass

# Order matters: utf-8-sig first so a BOM is consumed rather than becoming a
# stray character at the start of the first cue, and cp1252 before latin-1
# because it is a superset for the printable range that actually differs
# (curly quotes and dashes, which subtitle files are full of).
_ENCODINGS = ("utf-8-sig", "utf-8", "cp1252", "latin-1")

_SRT_TIME = r"(\d+):(\d{2}):(\d{2})[,.](\d{1,3})"
_VTT_TIME = r"(?:(\d+):)?(\d{2}):(\d{2})[.,](\d{1,3})"
_ARROW = r"\s*-->\s*"

_SRT_CUE_RE = re.compile(rf"{_SRT_TIME}{_ARROW}{_SRT_TIME}")
_VTT_CUE_RE = re.compile(rf"{_VTT_TIME}{_ARROW}{_VTT_TIME}")

# <i>, </font color="#fff">, and the like. Subtitle styling is presentation we
# re-impose ourselves; leaving the tags in would make them clickable "words".
_TAG_RE = re.compile(r"</?[a-zA-Z][^>]*>")
# ASS override blocks: {\an8}, {\pos(192,230)}, {\i1}.
_ASS_OVERRIDE_RE = re.compile(r"\{[^}]*\}")
_ASS_DRAWING_RE = re.compile(r"\\p[0-9]+")


@dataclass(frozen=True)
class Cue:
    start_ms: int
    end_ms: int
    text: str


class SubtitleParseError(Exception):
    """The bytes were readable but contained no cue this parser understood."""


def decode(raw: bytes) -> str:
    """Text out of a subtitle file of unknown encoding.

    Tried in order rather than sniffed with a detector library: the candidate
    list is four long, three of them cannot fail, and adding chardet for this
    would be a dependency for a problem that a loop solves.
    """
    for encoding in _ENCODINGS:
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def _clean(text: str) -> str:
    text = _ASS_OVERRIDE_RE.sub("", text)
    text = _TAG_RE.sub("", text)
    text = text.replace("\\N", "\n").replace("\\n", "\n").replace("\\h", " ")
    # Collapse the hard line breaks a subtitler used for on-screen width. The
    # cue is one sentence to a learner, and re-wrapping is our job, not the
    # original subtitler's.
    lines = [ln.strip() for ln in text.splitlines()]
    return " ".join(ln for ln in lines if ln).strip()


def _ms(hours: str | None, minutes: str, seconds: str, fraction: str) -> int:
    # A 2-digit fraction is centiseconds (ASS), 3 digits milliseconds.
    frac = int(fraction.ljust(3, "0")[:3]) if len(fraction) != 2 else int(fraction) * 10
    return ((int(hours or 0) * 3600) + (int(minutes) * 60) + int(seconds)) * 1000 + frac


def parse_srt(text: str) -> list[Cue]:
    cues: list[Cue] = []
    for block in re.split(r"\r?\n\s*\r?\n", text.strip()):
        lines = [ln for ln in block.splitlines() if ln.strip()]
        if not lines:
            continue
        timing_at = next((i for i, ln in enumerate(lines) if _SRT_CUE_RE.search(ln)), None)
        if timing_at is None:
            continue
        match = _SRT_CUE_RE.search(lines[timing_at])
        assert match is not None
        g = match.groups()
        body = _clean("\n".join(lines[timing_at + 1 :]))
        if not body:
            continue
        cues.append(Cue(start_ms=_ms(g[0], g[1], g[2], g[3]), end_ms=_ms(g[4], g[5], g[6], g[7]), text=body))
    return cues


def parse_vtt(text: str) -> list[Cue]:
    cues: list[Cue] = []
    for block in re.split(r"\r?\n\s*\r?\n", text.strip()):
        lines = [ln for ln in block.splitlines() if ln.strip()]
        if not lines:
            continue
        head = lines[0].strip().upper()
        # WEBVTT header, and the metadata blocks that may follow it.
        if head.startswith("WEBVTT") or head.startswith(("NOTE", "STYLE", "REGION")):
            continue
        timing_at = next((i for i, ln in enumerate(lines) if _VTT_CUE_RE.search(ln)), None)
        if timing_at is None:
            continue
        match = _VTT_CUE_RE.search(lines[timing_at])
        assert match is not None
        g = match.groups()
        body = _clean("\n".join(lines[timing_at + 1 :]))
        if not body:
            continue
        cues.append(Cue(start_ms=_ms(g[0], g[1], g[2], g[3]), end_ms=_ms(g[4], g[5], g[6], g[7]), text=body))
    return cues


def parse_ass(text: str) -> list[Cue]:
    """ASS/SSA. Field order is declared by the `Format:` line inside
    [Events] and genuinely varies between files, so it is read rather than
    assumed — the common failure in naive ASS parsers is hard-coding Text at
    index 9 and silently producing the Effect column instead."""
    cues: list[Cue] = []
    fields: list[str] = []
    in_events = False

    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("["):
            in_events = stripped.lower().startswith("[events")
            continue
        if not in_events:
            continue
        if stripped.lower().startswith("format:"):
            fields = [f.strip().lower() for f in stripped.split(":", 1)[1].split(",")]
            continue
        if not stripped.lower().startswith("dialogue:"):
            continue
        if not fields:
            fields = ["layer", "start", "end", "style", "name", "marginl", "marginr", "marginv", "effect", "text"]

        # Text is always last and may itself contain commas, so the split is
        # capped at the number of preceding fields.
        parts = stripped.split(":", 1)[1].split(",", len(fields) - 1)
        if len(parts) < len(fields):
            continue
        row = dict(zip(fields, (p.strip() for p in parts)))
        raw_text = row.get("text", "")
        if _ASS_DRAWING_RE.search(raw_text):
            # A vector drawing dressed as a subtitle (signs, karaoke effects).
            continue
        body = _clean(raw_text)
        if not body:
            continue
        start = _parse_ass_time(row.get("start", ""))
        end = _parse_ass_time(row.get("end", ""))
        if start is None or end is None:
            continue
        cues.append(Cue(start_ms=start, end_ms=end, text=body))
    return cues


_ASS_TIME_RE = re.compile(r"(\d+):(\d{2}):(\d{2})[.:](\d{1,3})")


def _parse_ass_time(raw: str) -> int | None:
    match = _ASS_TIME_RE.match(raw.strip())
    if match is None:
        return None
    g = match.groups()
    return _ms(g[0], g[1], g[2], g[3])


def normalise(cues: list[Cue]) -> list[Cue]:
    """Sort, drop the unusable, and stop cues overlapping their successor.

    Overlap matters more than it looks: "which cue is on screen now" has to
    have one answer, and ASS in particular stacks simultaneous cues for
    different speakers. Keeping both and picking the earliest-starting one is
    predictable; showing them interleaved is not.
    """
    cleaned = [c for c in cues if c.text and c.end_ms > c.start_ms >= 0]
    cleaned.sort(key=lambda c: (c.start_ms, c.end_ms))
    return cleaned


def parse(raw: bytes, *, suffix: str) -> list[Cue]:
    """Parse by extension, falling back to trying every parser.

    The fallback is not paranoia: files named .srt containing WebVTT (and vice
    versa) are common, because both get produced by the same tools and renamed
    by hand.
    """
    text = decode(raw)
    ext = suffix.lower().lstrip(".")
    order = {
        "srt": (parse_srt, parse_vtt, parse_ass),
        "vtt": (parse_vtt, parse_srt, parse_ass),
        "webvtt": (parse_vtt, parse_srt, parse_ass),
        "ass": (parse_ass, parse_srt, parse_vtt),
        "ssa": (parse_ass, parse_srt, parse_vtt),
    }.get(ext, (parse_srt, parse_vtt, parse_ass))

    for parser in order:
        cues = normalise(parser(text))
        if cues:
            return cues
    raise SubtitleParseError("No subtitle cues could be read from this file.")


def to_vtt(cues: list[Cue]) -> str:
    """Serialise back to WebVTT, for the on-disk copy of a track."""
    out = ["WEBVTT", ""]
    for cue in cues:
        out.append(f"{_vtt_stamp(cue.start_ms)} --> {_vtt_stamp(cue.end_ms)}")
        out.append(cue.text)
        out.append("")
    return "\n".join(out)


def _vtt_stamp(ms: int) -> str:
    hours, rest = divmod(max(0, ms), 3_600_000)
    minutes, rest = divmod(rest, 60_000)
    seconds, millis = divmod(rest, 1000)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d}.{millis:03d}"
