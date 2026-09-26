class EngineUnavailable(Exception):
    """A voice engine (LLM/STT/TTS) couldn't load or run.

    Raised instead of faking a reply/transcript/audio clip — same discipline
    as app.services.leveling.base.EngineUnavailable, which this mirrors
    rather than imports from (that one is scoped to text-leveling modes;
    this one covers the Conversation feature's three inference engines)."""
