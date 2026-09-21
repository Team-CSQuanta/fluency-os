"""Local text-to-speech via Kokoro (kokoro-onnx). Voice model+voices file
must already be downloaded (via Settings/download_manager.py — this module
never downloads implicitly) and the loaded Kokoro instance is cached at
module level, same lazy-singleton shape as llm_chat_engine/stt_engine.

Replaced Piper here: Piper's "medium" voice was noticeably robotic. Kokoro
is a meaningfully more natural-sounding neural TTS, still CPU-viable at this
int8 quantization (~114MB model + ~28MB voices)."""

import io
import threading
import wave

import numpy as np

from app.services.voice import model_manager, reply_chunking
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
        raise EngineUnavailable(
            "This build of FluencyOS can't read replies aloud — the optional "
            "component for it (kokoro-onnx) isn't installed."
        ) from err
    model_path, voices_path = model_manager.tts_voice_paths()
    if not model_path.exists() or not voices_path.exists():
        raise EngineUnavailable("The voice that reads replies aloud isn't downloaded yet — download it in Settings first.")
    try:
        import onnxruntime as ort

        # Build the session ourselves purely to quiet it down. The fp16 graph
        # has ~144 Reciprocal nodes with no fp16 CPU kernel, so onnxruntime
        # logs "can't constant fold" for every one of them on every load, and
        # repeats it per optimizer pass — hundreds of lines of stderr that look
        # like failures and bury real errors. They are advisory: those nodes
        # are simply computed at runtime instead of being folded at load, which
        # measured no slower. Errors still surface (severity 3).
        options = ort.SessionOptions()
        options.log_severity_level = 3
        session = ort.InferenceSession(
            str(model_path), sess_options=options, providers=["CPUExecutionProvider"]
        )
        _kokoro = Kokoro.from_session(session, str(voices_path))
    except Exception as err:  # noqa: BLE001
        raise EngineUnavailable(f"Couldn't load the local TTS voice: {err}") from err
    return _kokoro


def is_ready() -> bool:
    return _kokoro is not None


def warm_up() -> None:
    """See llm_chat_engine.warm_up — same explicit-load-ahead-of-use idea."""
    with _lock:
        _load_kokoro_locked()


def unload() -> None:
    """See llm_chat_engine.unload — called when the voice is deleted from
    disk via Settings. Only one TTS option exists, so any delete means
    unconditionally unload."""
    global _kokoro
    with _lock:
        _kokoro = None


def split_for_streaming(text: str) -> list[str]:
    """See reply_chunking — the rule is shared with the other voice engine
    because it follows from how audio is served, not from Kokoro."""
    return reply_chunking.split_for_streaming(text)


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
