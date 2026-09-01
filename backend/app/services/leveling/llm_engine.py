"""The generative half of leveling: `contextual` and `semantic` (spec §7.3).

Both modes reorder and rewrite whole sentences, which no wordlist can do. They
need a configured model, and Increment 2 installs none — so this engine exists
to be *honestly unavailable* rather than to fake a result.

`is_available()` reads user_settings the same way the rest of the app does. The
moment a model is configured, `level()` is the only function that has to grow a
body; nothing above it changes, because the router and cache already treat this
as an interchangeable Engine.
"""

import sqlite3

from app.services.leveling.base import (
    GENERATIVE_MODES,
    EngineUnavailable,
    LeveledText,
    Mode,
)


def configured_model(conn: sqlite3.Connection, user_id: str | None) -> str | None:
    """The model id this user has configured, or None when running offline."""
    if user_id is None:
        return None
    row = conn.execute(
        "SELECT llm_mode, llm_model_id FROM user_settings WHERE user_id = ?", (user_id,)
    ).fetchone()
    if row is None:
        return None
    model_id = row["llm_model_id"]
    if not model_id:
        return None
    return str(model_id)


class LlmEngine:
    def __init__(self, model_id: str | None = None) -> None:
        self.model_id = model_id
        self.name = f"llm:{model_id}" if model_id else "llm:unconfigured"

    def supports(self, mode: Mode) -> bool:
        return mode in GENERATIVE_MODES

    def level(self, text: str, mode: Mode, target_cefr: str) -> LeveledText:
        if not self.supports(mode):
            raise EngineUnavailable(f"{mode} is handled by the rules engine")
        if self.model_id is None:
            raise EngineUnavailable(
                "No language model is configured, so this rewrite can't be generated."
            )
        # Reached only once a model is wired up (the inference increment).
        raise EngineUnavailable(
            f"Model {self.model_id} is configured but text generation isn't wired up yet."
        )
