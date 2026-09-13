"""Reports whether each voice engine is ready, so the UI can show real
status (e.g. "warming up the local model...") on a slow first load
instead of a silent hang. Loading happens lazily on first real use
(see each engine's _get_*() singleton) — this module only reports state,
it never triggers a load itself."""

from app.services.voice import llm_chat_engine, stt_engine, tts


def status(expected_llm_path: str | None = None, expected_tts: str | None = None) -> dict[str, str]:
    """`expected_llm_path`, when given, is the GGUF path for whichever LLM
    is *currently selected* — the loaded model must match it, not just be
    *a* loaded model. Without this, switching to a different (downloaded)
    model in Settings would still read as "ready" off the previously-loaded
    one, and the first real turn afterward would silently eat a reload
    instead of the learner choosing when via Launch AI."""
    llm_ready = llm_chat_engine.is_ready_for(expected_llm_path) if expected_llm_path is not None else llm_chat_engine.is_ready()
    # `expected_tts` is the voice-engine counterpart of `expected_llm_path`,
    # and is needed for the same reason: with Kokoro resident and Pocket TTS
    # selected, "some voice is loaded" is true while the voice about to be
    # used is not, so the next turn would silently pay a model load mid-
    # conversation instead of the learner choosing when via Launch AI.
    #
    # Without it, this answers the other question — what is occupying RAM —
    # which is what the global indicator wants, since switching the setting
    # doesn't hand back the memory the previous engine is still holding.
    tts_ready = tts.engine_for(expected_tts).is_ready() if expected_tts is not None else tts.any_ready()
    return {
        "llm": "ready" if llm_ready else "not_loaded",
        "stt": "ready" if stt_engine.is_ready() else "not_loaded",
        "tts": "ready" if tts_ready else "not_loaded",
    }
