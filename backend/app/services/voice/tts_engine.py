"""Local text-to-speech via Kokoro (kokoro-onnx). Voice model+voices file
must already be downloaded (via Settings/download_manager.py — this module
never downloads implicitly) and the loaded Kokoro instance is cached at
module level, same lazy-singleton shape as llm_chat_engine/stt_engine.

Replaced Piper here: Piper's "medium" voice was noticeably robotic. Kokoro
is a meaningfully more natural-sounding neural TTS, still CPU-viable at this
int8 quantization (~114MB model + ~28MB voices)."""

import io
import re
import threading
import wave
from pathlib import Path

import numpy as np

from app.services.voice import model_manager
from app.services.voice.errors import EngineUnavailable

VOICE = model_manager.TTS_VOICE
LANG = "en-us"

_lock = threading.Lock()
_kokoro = None


def _load_kokoro_locked():
    """Must only be called while holding `_lock` — see the matching note in
    llm_chat_engine._load_llm_locked for why the whole load-and-synthesize
    operation, not just loading, needs to be serialized."""
    global _kokoro
    if _kokoro is not None:
        return _kokoro
    try:
        from kokoro_onnx import Kokoro
    except ImportError as err:
        raise EngineUnavailable("kokoro-onnx isn't installed") from err
    model_path, voices_path = model_manager.tts_voice_paths()
    if not model_path.exists() or not voices_path.exists():
        raise EngineUnavailable("The local TTS voice isn't downloaded yet — download it in Settings first.")
    try:
        _kokoro = Kokoro(str(model_path), str(voices_path))
    except Exception as err:  # noqa: BLE001
        raise EngineUnavailable(f"Couldn't load the local TTS voice: {err}") from err
    return _kokoro


def is_ready() -> bool:
    return _kokoro is not None


def warm_up() -> None:
    """See llm_chat_engine.warm_up — same explicit-load-ahead-of-use idea.
    Also renders the instant acknowledgments if they aren't on disk yet, so
    that one-off cost lands on Launch AI rather than mid-conversation."""
    with _lock:
        _load_kokoro_locked()
    ensure_backchannels()


def unload() -> None:
    """See llm_chat_engine.unload — called when the voice is deleted from
    disk via Settings. Only one TTS option exists, so any delete means
    unconditionally unload."""
    global _kokoro
    with _lock:
        _kokoro = None


# Synthesis on this hardware runs slower than real time (~2.4s of compute per
# second of speech), so waiting for a whole reply before any of it is audible
# costs tens of seconds. Splitting on sentence boundaries lets the first
# sentence start playing while the rest is still being made.
_SENTENCE_END = re.compile(r"(?<=[.!?])\s+")
# An opener shorter than this (roughly two words) is not worth a separate
# synthesis call: its own ~0.9s fixed cost would exceed what splitting saves.
# Anything longer is worth it — measured, "That sounds lovely." is audible in
# 4.4s on its own versus 8.0s if folded into the sentence after it.
_MIN_CHUNK_CHARS = 12


def split_for_streaming(text: str) -> list[str]:
    """At most two pieces: the opening sentence, then everything else.

    Measured cost on this hardware is ~0.9s fixed per call plus ~2.65s per
    second of audio. So every additional chunk buys nothing but its own 0.9s
    of overhead — splitting a reply four ways makes the reply as a whole
    ~2.7s slower. Exactly one split is worth paying for: it gets the first
    sentence audible far sooner, and the remainder is then synthesized in
    parallel while that sentence plays."""
    clean = (text or "").strip()
    if not clean:
        return []
    sentences = [p.strip() for p in _SENTENCE_END.split(clean) if p.strip()]
    if len(sentences) <= 1:
        return sentences
    head, rest = sentences[0], " ".join(sentences[1:])
    # A one-word opener isn't worth its own 0.9s call — it would delay the
    # remainder without meaningfully advancing the first sound.
    if len(head) < _MIN_CHUNK_CHARS:
        return [f"{head} {rest}"]
    return [head, rest]


def synthesize(text: str) -> bytes:
    """Returns WAV bytes for the given text."""
    clean = text.strip()
    if not clean:
        raise EngineUnavailable("Nothing to synthesize")

    # The lock covers loading only. ONNX inference is thread-safe, and
    # synthesizing two sentences at once measured 1.45x faster than one after
    # the other on this hardware — verified to produce uncorrupted audio
    # (identical durations, no NaN) under concurrency. Holding the lock across
    # create() would serialize that away.
    with _lock:
        kokoro = _load_kokoro_locked()
    try:
        samples, sample_rate = kokoro.create(clean, voice=VOICE, speed=1.0, lang=LANG)
    except Exception as err:  # noqa: BLE001
        raise EngineUnavailable(f"Local speech synthesis failed: {err}") from err

    pcm16 = (np.clip(samples, -1.0, 1.0) * 32767).astype(np.int16)
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(pcm16.tobytes())
    return buffer.getvalue()


# Short things the AI can say the instant the learner stops talking, while the
# real reply is still being transcribed, generated and synthesized.
#
# They exist because synthesis here costs ~0.9s fixed + ~2.65s per second of
# audio, so *nothing* newly spoken can be audible in under ~2s. Rendering these
# once and replaying the files is the only way to answer immediately — and
# being heard immediately is most of what makes a conversation feel live.
BACKCHANNELS = ("Mm-hmm.", "Right.", "Okay.", "I see.", "Got it.")


def backchannel_path(index: int) -> Path:
    return model_manager.models_dir() / "backchannels" / f"ack_{index}.wav"


def ensure_backchannels() -> list[Path]:
    """Renders the acknowledgments once and reuses them forever after. Called
    when the voice is warmed up, so the cost lands on an explicit launch rather
    than inside the learner's first turn."""
    paths = []
    for i, phrase in enumerate(BACKCHANNELS):
        path = backchannel_path(i)
        if not path.exists():
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(synthesize(phrase))
        paths.append(path)
    return paths
