"""Evening out the silences in synthesized speech.

Both voices leave more silence than a person would. Measured over 40 Pocket
TTS replies: 0.2-0.45s before the first word, 0.1-0.4s after the last, and
0.4-1.1s between sentences — the longest after a short exclamation or
question ("Scratches?" 0.6s, "Online?" 0.74s, "a top-quality model." 0.96s),
where people pause for 0.2-0.4s. Between two clips of one reply the trailing
and leading silence add up, so the voice seemed to stop dead at the end of a
sentence.

Only silence is cut, and only the middle of a long stretch of it: the start
and end of every pause are kept, so the breath and the tail of the last word
around it are untouched, and a pause stays a pause — it just stops being a
hesitation.
"""

import io
import wave

import numpy as np

_FRAME_S = 0.01
#: Quieter than this share of the reply's loud frames counts as silence.
#: Unvoiced sounds (s, f, h) sit well above it; so does a breath.
_SILENCE_SHARE = 0.06
#: The longest pause kept inside a clip: a full stop in unhurried speech.
MAX_PAUSE_S = 0.32
#: Silence kept before the first word and after the last. A little either
#: side, so a clip does not start or stop with a click.
LEAD_S = 0.04
TRAIL_S = 0.1
#: Crossfade over each cut, so joining two quiet stretches never clicks.
_FADE_S = 0.005


def tighten(wav_bytes: bytes) -> bytes:
    """The same 16-bit mono WAV with its pauses capped (see module doc).
    Anything it cannot read is returned untouched — a long pause is better
    than no audio."""
    try:
        with wave.open(io.BytesIO(wav_bytes)) as w:
            if w.getsampwidth() != 2 or w.getnchannels() != 1:
                return wav_bytes
            rate = w.getframerate()
            samples = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)
    except (wave.Error, EOFError):
        return wav_bytes

    kept = tighten_samples(samples, rate)
    if kept is samples:
        return wav_bytes
    out = io.BytesIO()
    with wave.open(out, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(kept.astype(np.int16).tobytes())
    return out.getvalue()


def tighten_samples(samples: np.ndarray, rate: int) -> np.ndarray:
    frame = max(1, int(rate * _FRAME_S))
    n = len(samples) // frame
    if n < 3:
        return samples
    x = samples[: n * frame].astype(np.float32) / 32768
    rms = np.sqrt((x.reshape(n, frame) ** 2).mean(axis=1))
    loud = np.percentile(rms, 95)
    if loud <= 0:
        return samples
    quiet = rms < loud * _SILENCE_SHARE

    # Silent runs, as [start, end) frame indices.
    edges = np.flatnonzero(np.diff(np.concatenate(([0], quiet.astype(np.int8), [0]))))
    runs = list(zip(edges[::2], edges[1::2]))
    if not runs:
        return samples

    cut: list[tuple[int, int]] = []  # sample ranges to drop
    for start, end in runs:
        if start == 0:
            keep = int(LEAD_S / _FRAME_S)
            if end - start > keep:
                cut.append((0, (end - keep) * frame))
        elif end == n:
            keep = int(TRAIL_S / _FRAME_S)
            if end - start > keep:
                cut.append(((start + keep) * frame, len(samples)))
        else:
            keep = int(MAX_PAUSE_S / _FRAME_S)
            if end - start > keep:
                # Keep both ends of the pause and drop its middle.
                half = keep // 2
                cut.append(((start + half) * frame, (end - (keep - half)) * frame))
    if not cut:
        return samples

    fade = max(1, int(rate * _FADE_S))
    pieces: list[np.ndarray] = []
    pos = 0
    for a, b in cut:
        pieces.append(samples[pos:a].astype(np.float32))
        pos = b
    pieces.append(samples[pos:].astype(np.float32))
    out = pieces[0]
    for piece in pieces[1:]:
        k = min(fade, len(out), len(piece))
        if k:
            ramp = np.linspace(0, 1, k, dtype=np.float32)
            out[-k:] = out[-k:] * (1 - ramp) + piece[:k] * ramp
            piece = piece[k:]
        out = np.concatenate((out, piece))
    return np.clip(out, -32768, 32767).astype(np.int16)
