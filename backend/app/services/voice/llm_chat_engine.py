"""Local LLM chat generation via llama-cpp-python, in-process inside this
backend (not a second spawned server) — matching hardware_capability.py's
own memory-budget framing, which only makes sense as a single process.

Lazy-imports llama_cpp so the rest of the backend keeps working even if it
fails to import/build on a given machine; the model itself is loaded once
and cached at module level (loading a ~1GB GGUF per request would be
unusable), reloaded only if the pinned model path changes.
"""

import os
import threading

from app.services.voice import model_manager
from app.services.voice.errors import EngineUnavailable
from app.services.voice.json_utils import parse_json_object

_lock = threading.Lock()
_llm = None
_loaded_path: str | None = None


def _load_llm_locked(repo_id: str, filename: str):
    """Must only be called while holding `_lock`. A llama.cpp context isn't
    safe for concurrent calls from multiple threads — running two
    generations on the same instance at once (e.g. a turn from a session the
    user already navigated away from, still finishing server-side, overlapping
    with a freshly-started session's opening line) corrupts internal state
    and can hang both requests indefinitely rather than just being slow. So
    every caller holds `_lock` for the full load-and-generate operation,
    which serializes engine use instead of racing it."""
    global _llm, _loaded_path
    model_path = model_manager.llm_model_path(repo_id, filename)
    if not model_path.exists():
        raise EngineUnavailable(
            "Your AI model isn't downloaded yet — download it in Settings before starting a conversation."
        )
    path = str(model_path)
    if _llm is not None and _loaded_path == path:
        return _llm
    try:
        from llama_cpp import Llama
    except ImportError as err:
        raise EngineUnavailable(
            "This build of FluencyOS can't run a local AI model — the optional "
            "component for it (llama-cpp-python) isn't installed. You can use a cloud "
            "provider instead, in Settings."
        ) from err
    # Release the outgoing model *before* allocating the replacement. Holding
    # both at once doubles peak memory for the length of the load, which on a
    # light machine is precisely when switching models runs out of RAM.
    _llm = None
    _loaded_path = None
    try:
        _llm = Llama(
            model_path=path,
            n_ctx=4096,
            n_threads=max(1, (os.cpu_count() or 2) - 1),
            verbose=False,
        )
        _loaded_path = path
    except Exception as err:  # noqa: BLE001 — any load failure is "unavailable"
        _llm = None
        _loaded_path = None
        raise EngineUnavailable(f"Couldn't load the local LLM: {err}") from err
    return _llm


def is_ready() -> bool:
    return _llm is not None


def is_ready_for(model_path: str) -> bool:
    """Like is_ready(), but specific to one model file — a *different*
    model being loaded (e.g. right after switching selection in Settings)
    must not read as "AI is launched", or a turn would silently pay the
    reload cost mid-conversation instead of the learner choosing when via
    Launch AI. See loaded_path()/_loaded_path for what's actually resident."""
    return _llm is not None and _loaded_path == model_path


def loaded_path() -> str | None:
    return _loaded_path


def unload(model_path: str | None = None) -> None:
    """Called when a model file is deleted from disk (Settings' delete
    button) — an in-memory Llama instance for a now-deleted file is no
    longer meaningfully "ready". Acquires the same lock generation uses, so
    this waits for any in-flight reply rather than racing it. If
    `model_path` is given, only unloads when it matches what's actually
    loaded (deleting a *different*, non-selected option shouldn't drop the
    one currently in use); omit it to unconditionally unload (STT/TTS have
    only one option each, so any delete means "unload it")."""
    global _llm, _loaded_path
    with _lock:
        if model_path is None or _loaded_path == model_path:
            _llm = None
            _loaded_path = None


def warm_up(repo_id: str, filename: str) -> None:
    """Explicitly loads the model into memory ahead of any real use — the
    "Launch AI" action calls this so a deliberate click pays the cold-load
    cost (real minutes on this hardware tier) instead of it happening
    silently inside whatever the first real request turns out to be."""
    with _lock:
        _load_llm_locked(repo_id, filename)


def generate_reply(
    system_prompt: str, history: list[tuple[str, str]], *, repo_id: str, filename: str, max_tokens: int = 220
) -> str:
    """history: list of (role, text) pairs, role in {'user', 'assistant'}."""
    messages = [{"role": "system", "content": system_prompt}]
    messages.extend({"role": role, "content": text} for role, text in history)

    with _lock:
        llm = _load_llm_locked(repo_id, filename)
        try:
            result = llm.create_chat_completion(messages=messages, max_tokens=max_tokens, temperature=0.7)
        except Exception as err:  # noqa: BLE001
            raise EngineUnavailable(f"Local LLM generation failed: {err}") from err

    text = result["choices"][0]["message"]["content"]
    return text.strip()


def generate_json(
    system_prompt: str,
    user_prompt: str,
    *,
    repo_id: str,
    filename: str,
    max_tokens: int = 300,
    temperature: float = 0.4,
) -> dict:
    """Shared by every feature that wants a structured (JSON) answer from the
    local model rather than free-form chat text — the post-chat report analysis
    and Vocabulary's AI explain/examples/mnemonic/practice features. The
    prompts themselves live in the services, never here."""
    with _lock:
        llm = _load_llm_locked(repo_id, filename)
        try:
            result = llm.create_chat_completion(
                messages=[{"role": "system", "content": system_prompt}, {"role": "user", "content": user_prompt}],
                max_tokens=max_tokens,
                temperature=temperature,
            )
        except Exception as err:  # noqa: BLE001
            raise EngineUnavailable(f"Local LLM generation failed: {err}") from err

    raw = result["choices"][0]["message"]["content"].strip()
    parsed = parse_json_object(raw)
    if parsed is None:
        raise EngineUnavailable("The local LLM's response wasn't valid JSON")
    return parsed
