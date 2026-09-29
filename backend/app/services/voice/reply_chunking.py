"""How a spoken reply is cut up before synthesis.

Shared by both voice engines, because the reason for splitting is not a
property of either of them — it is a property of how this app serves audio.
`ensure_audio_chunk` synthesizes a chunk to a complete WAV file and only then
serves it, so what a learner waits for is the full synthesis of chunk 0, never
an engine's internal time-to-first-frame. Cutting the opening sentence off is
what makes that first wait short.

Measured on the reference machine (Ryzen 3 3200G, 4 cores, no AVX-512/VNNI),
synthesizing the first sentence alone rather than the whole reply:

    Kokoro       2.44s -> (already split)
    Pocket TTS   2.05s -> 1.09s

Pocket TTS streams internally and so needs no split to produce sound early —
but that sound cannot reach the client through a file endpoint, so it needs
the split just as much as Kokoro does. Were audio ever streamed end to end,
its first frame lands in ~0.25s and this module stops mattering for it.
"""

import re

_SENTENCE_END = re.compile(r"(?<=[.!?])\s+")

# An opener shorter than this (roughly two words) is not worth its own
# synthesis call: the per-call fixed cost would exceed what splitting saves,
# and it delays the remainder without meaningfully advancing the first sound.
_MIN_CHUNK_CHARS = 12

# How much slower than measured to assume synthesis runs when planning pieces.
_GROWTH_MARGIN = 1.35


def split_for_streaming(text: str, synth_ratio: float | None = None) -> list[str]:
    """The reply in the pieces it is synthesized and played in.

    Without `synth_ratio` — an engine slower than real time, Kokoro here —
    at most two pieces: the opening sentence, then everything else. Each
    additional chunk buys nothing but its own fixed cost — on Kokoro,
    splitting a reply four ways measured ~2.7s slower overall. One split is
    worth paying for: it gets the first sentence audible far sooner, and the
    remainder is synthesized while it plays.

    With it — seconds of synthesis per second of audio, for an engine faster
    than real time — pieces that grow. The player asks for piece N+1 as
    piece N starts playing, so N+1 has exactly N's playing time to be
    synthesized in. Two pieces broke that whenever the opener was short: "They
    aren't severe!" plays for 1.4s, the 4.6s remainder took 2.4s to make, and
    the learner heard a second of dead air after the exclamation mark. Each
    piece here is kept small enough to be ready before the one before it ends,
    so the first sound comes as soon as before and nothing stops after it."""
    clean = (text or "").strip()
    if not clean:
        return []
    sentences = [p.strip() for p in _SENTENCE_END.split(clean) if p.strip()]
    if len(sentences) <= 1:
        return sentences
    if synth_ratio is None or synth_ratio >= 1:
        head, rest = sentences[0], " ".join(sentences[1:])
        if len(head) < _MIN_CHUNK_CHARS:
            return [f"{head} {rest}"]
        return [head, rest]

    head, rest = sentences[0], sentences[1:]
    while len(head) < _MIN_CHUNK_CHARS and rest:
        head = f"{head} {rest.pop(0)}"
    if not rest:
        return [head]

    # Characters stand in for seconds: speech length follows text length
    # closely enough, and the margin covers the rest — the request, the
    # fixed cost of a call, and a CPU also busy with the rest of the app.
    growth = 1 / (synth_ratio * _GROWTH_MARGIN)
    pieces, current = [head], ""
    for sentence in rest:
        joined = f"{current} {sentence}".strip()
        if current and len(joined) > growth * len(pieces[-1]):
            pieces.append(current)
            joined = sentence
        current = joined
    pieces.append(current)
    return pieces
