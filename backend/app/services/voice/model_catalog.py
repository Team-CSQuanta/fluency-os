"""The set of models Settings lets a user pick from and download.

Only the LLM is a real choice today (size/quality tradeoff, all CPU-viable
on this app's stated hardware tiers — see hardware_capability.py). STT/TTS
have exactly one supported option each right now, but are still listed here
so Settings can show their real download status rather than hiding them.
"""

import shutil
from dataclasses import dataclass
from pathlib import Path

from app.services.voice import model_manager

DEFAULT_LLM_KEY = "qwen2.5-1.5b"


@dataclass(frozen=True)
class LlmOption:
    key: str
    label: str
    repo_id: str
    filename: str
    approx_size_mb: int
    note: str


LLM_OPTIONS: tuple[LlmOption, ...] = (
    LlmOption(
        key="qwen2.5-0.5b",
        label="Qwen2.5 0.5B",
        repo_id="Qwen/Qwen2.5-0.5B-Instruct-GGUF",
        filename="qwen2.5-0.5b-instruct-q4_k_m.gguf",
        approx_size_mb=491,
        note="fastest, least capable — best for very limited RAM",
    ),
    LlmOption(
        key="qwen2.5-1.5b",
        label="Qwen2.5 1.5B",
        repo_id="Qwen/Qwen2.5-1.5B-Instruct-GGUF",
        filename="qwen2.5-1.5b-instruct-q4_k_m.gguf",
        approx_size_mb=1117,
        note="recommended default",
    ),
    LlmOption(
        key="qwen2.5-3b",
        label="Qwen2.5 3B",
        repo_id="Qwen/Qwen2.5-3B-Instruct-GGUF",
        filename="qwen2.5-3b-instruct-q4_k_m.gguf",
        approx_size_mb=2105,
        note="best quality — needs more RAM and is slower per reply",
    ),
    LlmOption(
        key="gemma-3-1b",
        label="Gemma 3 1B",
        repo_id="ggml-org/gemma-3-1b-it-GGUF",
        filename="gemma-3-1b-it-Q4_K_M.gguf",
        approx_size_mb=769,
        note="smallest Gemma — the one that fits where Gemma 4 won't",
    ),
    LlmOption(
        key="gemma-4-e2b",
        label="Gemma 4 E2B",
        repo_id="unsloth/gemma-4-E2B-it-GGUF",
        filename="gemma-4-E2B-it-Q4_K_M.gguf",
        approx_size_mb=2963,
        note="needs ~3 GB of free RAM to load, on top of the download",
    ),
    LlmOption(
        key="gemma-4-e4b",
        label="Gemma 4 E4B",
        repo_id="unsloth/gemma-4-E4B-it-GGUF",
        filename="gemma-4-E4B-it-Q4_K_M.gguf",
        approx_size_mb=4747,
        note="strongest local option — needs ~5 GB of free RAM, well beyond a light machine",
    ),
)

_LLM_BY_KEY = {o.key: o for o in LLM_OPTIONS}


def llm_option(key: str | None) -> LlmOption:
    if key and key in _LLM_BY_KEY:
        return _LLM_BY_KEY[key]
    return _LLM_BY_KEY[DEFAULT_LLM_KEY]


def llm_dest_path(option: LlmOption) -> Path:
    return model_manager.models_dir() / option.filename


def llm_is_downloaded(option: LlmOption) -> bool:
    return llm_dest_path(option).exists()


def llm_delete(option: LlmOption) -> bool:
    """Frees real disk space (hundreds of MB to a couple GB per option).
    Returns whether a file was actually removed — a no-op delete of an
    already-absent model isn't an error, just nothing to do."""
    path = llm_dest_path(option)
    if not path.exists():
        return False
    path.unlink()
    return True


def tts_is_downloaded() -> bool:
    model_path, voices_path = model_manager.tts_voice_paths()
    return model_path.exists() and voices_path.exists()


def tts_delete() -> bool:
    deleted = False
    for path in model_manager.tts_voice_paths():
        if path.exists():
            path.unlink()
            deleted = True
    # Older builds of the voice (the int8 one this app used to ship) are stale
    # once the voice is gone — leaving one behind would waste ~114MB.
    for stale in model_manager.models_dir().glob("kokoro-v1.0*.onnx"):
        stale.unlink(missing_ok=True)
        deleted = True
    return deleted


POCKET_TTS_SIZE_MB = 225


def pocket_tts_is_downloaded() -> bool:
    return all(path.exists() for path in model_manager.pocket_tts_paths())


def pocket_tts_delete() -> bool:
    """Removes the whole pocket-tts folder, including the config.yaml the
    engine writes there — that file names absolute paths to weights that are
    about to stop existing, so leaving it behind would only be a trap on the
    next download."""
    weights, _, _ = model_manager.pocket_tts_paths()
    folder = weights.parent
    if not folder.exists():
        return False
    shutil.rmtree(folder, ignore_errors=True)
    return True


# faster-whisper's own on-disk cache layout — not importing stt_engine here
# (it would import this module back for the same check, circularly), so this
# just looks for any cached faster-whisper model rather than one exact size.
def stt_is_downloaded() -> bool:
    return any(model_manager.whisper_cache_dir().glob("models--Systran--faster-whisper-*/**/model.bin"))


def stt_delete() -> bool:
    deleted = False
    for entry in model_manager.whisper_cache_dir().glob("models--Systran--faster-whisper-*"):
        shutil.rmtree(entry, ignore_errors=True)
        deleted = True
    return deleted
