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
# Kokoro is a meaningfully more natural-sounding neural TTS). Files come from
# the kokoro-onnx package's own GitHub releases — NOT the onnx-community HF
# repo, whose per-voice .bin files are a different, incompatible format that
# segfaults onnxruntime if fed to this package's inference code.
#
# fp16, deliberately, NOT the smaller int8 build. int8 matmuls are only fast on
# CPUs with VNNI (AVX512-VNNI / AVX-VNNI); without it onnxruntime pays
# quantize/dequantize on every op and gets no hardware speedup back. Measured
# on a Zen+ chip (AVX2, no VNNI): int8 ran at 2.97x slower than real time and
# fp16 at 0.56x — a 4.6x difference from the same model and the same voice.
# Crossing under 1.0x is the part that matters: speech can now be produced
# faster than it plays, so a reply no longer has gaps in it. The extra ~50MB
# of download is worth several seconds per turn.
TTS_MODEL_URL = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/kokoro-v1.0.fp16.onnx"
TTS_VOICES_URL = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/voices-v1.0.bin"
TTS_VOICE = "af_heart"

# Pocket TTS (Kyutai) — the alternative voice engine. Kokoro is non-streaming:
# nothing is audible until a whole chunk is synthesized. Pocket TTS is
# autoregressive and yields audio while still generating, so its first sound
# doesn't wait on the rest of the sentence.
#
# Pulled from the "-without-voice-cloning" repo deliberately. The main
# kyutai/pocket-tts repo is gated — it answers 401 without an accepted licence
# and an HF login, which a local-first app has no way to ask for mid-download.
# This mirror is public, and voice cloning is the only thing it drops; the
# 26 preset voices are all present and are all this app uses.
#
# english_2026-04 is the current 100M-parameter English model (~219MB of
# weights). The "_24l" variants are the same family at 24 layers and ~1.3GB —
# out of reach of the hardware tier this app targets.
_POCKET_REPO = "kyutai/pocket-tts-without-voice-cloning"
_POCKET_LANG = "english_2026-04"
POCKET_VOICE = "alba"
POCKET_MODEL_URL = f"https://huggingface.co/{_POCKET_REPO}/resolve/main/languages/{_POCKET_LANG}/model.safetensors"
POCKET_TOKENIZER_URL = f"https://huggingface.co/{_POCKET_REPO}/resolve/main/languages/{_POCKET_LANG}/tokenizer.model"
POCKET_VOICE_URL = (
    f"https://huggingface.co/{_POCKET_REPO}/resolve/main/languages/{_POCKET_LANG}"
    f"/embeddings/{POCKET_VOICE}.safetensors"
)


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
    return models_dir() / "kokoro-v1.0.fp16.onnx", models_dir() / "voices-v1.0.bin"


def pocket_tts_paths() -> tuple[Path, Path, Path]:
    """(weights, tokenizer, voice embedding), downloaded or not.

    Kept in a subdirectory because the config YAML written alongside them
    refers to them by name — one self-contained folder that can be deleted
    whole, the same way tts_delete() clears the Kokoro files."""
    d = models_dir() / "pocket-tts"
    return (
        d / "model.safetensors",
        d / "tokenizer.model",
        d / f"{POCKET_VOICE}.safetensors",
    )
