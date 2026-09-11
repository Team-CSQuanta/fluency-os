"""Resolves where local voice-engine model files live. Downloading is now a
deliberate, explicit action (see download_manager.py, triggered from
Settings) rather than something that happens implicitly the first time a
conversation is started — so every function here is pure path resolution,
never a network call.

Models are cached under a directory next to the app's own database file
(sibling to --db-path, same "lives next to the user's real data" choice
already made for conversation_audio/) rather than bundled in the repo —
they're multi-hundred-MB to multi-GB binaries.
"""

import os
from pathlib import Path

from app.config import settings

# huggingface_hub's newer "xet" chunked-transfer backend was observed to
# stall indefinitely partway through a large download (repeatedly restarting
# from 0 with a fresh temp file rather than resuming) — forcing the plain
# HTTP downloader is slower per-byte but actually completes. Also read by
# download_manager.py's own direct HTTP downloader indirectly via this
# module being imported first.
os.environ.setdefault("HF_HUB_DISABLE_XET", "1")

# Kokoro (replacing Piper — Piper's "medium" voice was noticeably robotic;
# Kokoro is a meaningfully more natural-sounding neural TTS while still
# staying CPU-viable at this int8 quantization, ~114MB). Files come from the
# kokoro-onnx package's own GitHub releases — NOT the onnx-community HF repo,
# whose per-voice .bin files are a different, incompatible format that
# segfaults onnxruntime if fed to this package's inference code.
TTS_MODEL_URL = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/kokoro-v1.0.int8.onnx"
TTS_VOICES_URL = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/voices-v1.0.bin"
TTS_VOICE = "af_heart"


def models_dir() -> Path:
    d = Path(settings.db_path).resolve().parent / "models"
    d.mkdir(parents=True, exist_ok=True)
    return d


def disk_usage_bytes() -> int:
    """Real total size of whatever's actually been downloaded here — walks
    the directory rather than summing catalog entries, so it's honest even
    about files a future catalog change doesn't know about (e.g. a leftover
    whisper cache from a previously-selected size)."""
    total = 0
    for path in models_dir().rglob("*"):
        if path.is_file():
            total += path.stat().st_size
    return total


def whisper_cache_dir() -> Path:
    d = models_dir() / "whisper"
    d.mkdir(parents=True, exist_ok=True)
    return d


def llm_model_path(repo_id: str, filename: str) -> Path:
    """Where this LLM option's GGUF would live, downloaded or not."""
    return models_dir() / filename


def tts_voice_paths() -> tuple[Path, Path]:
    """(model .onnx path, voices .bin path), downloaded or not."""
    return models_dir() / "kokoro-v1.0.int8.onnx", models_dir() / "voices-v1.0.bin"
