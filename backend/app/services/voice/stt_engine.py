"""Local speech-to-text via faster-whisper. Model size is pinned to
tiny.en — the smallest real option — given this app's stated hardware
tier (see hardware_capability.py). faster-whisper *can* auto-download it
from Hugging Face on construction, but that's exactly the implicit-download
behavior this app moved away from (see download_manager.py) — so this
module checks the cache itself first and refuses to construct the model
(and therefore trigger a download) until Settings has fetched it.
"""

import io
import threading

from app.services.voice import model_manager
from app.services.voice.errors import EngineUnavailable

MODEL_SIZE = "tiny.en"

_lock = threading.Lock()
_model = None


def _load_model_locked():
    """Must only be called while holding `_lock` — see the matching note in
    llm_chat_engine._load_llm_locked for why the whole load-and-transcribe
    operation, not just loading, needs to be serialized."""
    global _model
    if _model is not None:
        return _model
    try:
        from faster_whisper import WhisperModel
    except ImportError as err:
        raise EngineUnavailable("faster-whisper isn't installed") from err
    cache = model_manager.whisper_cache_dir()
    if not any(cache.glob(f"models--Systran--faster-whisper-{MODEL_SIZE}/**/model.bin")):
        raise EngineUnavailable("The local STT model isn't downloaded yet — download it in Settings first.")
    try:
        _model = WhisperModel(
            MODEL_SIZE,
            device="cpu",
            compute_type="int8",
            download_root=str(model_manager.whisper_cache_dir()),
        )
    except Exception as err:  # noqa: BLE001
        raise EngineUnavailable(f"Couldn't load the local STT model: {err}") from err
    return _model


def is_ready() -> bool:
    return _model is not None


def warm_up() -> None:
    """See llm_chat_engine.warm_up — same explicit-load-ahead-of-use idea."""
    with _lock:
        _load_model_locked()


def unload() -> None:
    """See llm_chat_engine.unload — called when the model is deleted from
    disk via Settings. Only one STT option exists, so any delete means
    unconditionally unload."""
    global _model
    with _lock:
        _model = None


def transcribe(audio_bytes: bytes) -> tuple[str, float]:
    """Returns (text, confidence) where confidence is a 0-1 proxy derived
    from the average log-probability faster-whisper reports per segment —
    a real signal, not a fabricated score, but explicitly a proxy for true
    word-level confidence (matches the report's existing `stt_proxy` naming).
    """
    with _lock:
        model = _load_model_locked()
        try:
            segments, _info = model.transcribe(io.BytesIO(audio_bytes), vad_filter=True, language="en")
            segments = list(segments)
        except Exception as err:  # noqa: BLE001
            raise EngineUnavailable(f"Local transcription failed: {err}") from err

    if not segments:
        return "", 0.0

    text = " ".join(s.text.strip() for s in segments).strip()
    avg_logprob = sum(s.avg_logprob for s in segments) / len(segments)
    # avg_logprob is typically in roughly [-1, 0]; clamp/rescale to a 0-1 proxy.
    confidence = max(0.0, min(1.0, 1.0 + avg_logprob))
    return text, confidence
