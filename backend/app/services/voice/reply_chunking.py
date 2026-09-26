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


def split_for_streaming(text: str) -> list[str]:
    """At most two pieces: the opening sentence, then everything else.

    Exactly one split, not more. Each additional chunk buys nothing but its
    own fixed cost — on Kokoro, splitting a reply four ways measured ~2.7s
    slower overall. One split is worth paying for: it gets the first sentence
    audible far sooner, and the remainder is synthesized while it plays."""
    clean = (text or "").strip()
    if not clean:
        return []
    sentences = [p.strip() for p in _SENTENCE_END.split(clean) if p.strip()]
    if len(sentences) <= 1:
        return sentences
    head, rest = sentences[0], " ".join(sentences[1:])
    if len(head) < _MIN_CHUNK_CHARS:
        return [f"{head} {rest}"]
    return [head, rest]
