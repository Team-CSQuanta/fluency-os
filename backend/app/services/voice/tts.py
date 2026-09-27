"""Which text-to-speech engine speaks, and the one interface both satisfy.

tts_engine (Kokoro) and pocket_tts_engine (Pocket TTS) expose the same five
functions — is_ready / warm_up / unload / split_for_streaming / synthesize —
so everything upstream of here can be engine-agnostic. This module is the
only place that knows which one a given user has chosen.

Pocket TTS is the default and the engine this app is tuned for. Kokoro is
kept as a fallback rather than removed: it needs no PyTorch and far less
memory, so on a machine where Pocket TTS will not load it is the difference
between a slower voice and no voice at all. It also remains the only option
if the optional runtime is somehow missing from an install.
"""

import sqlite3
from typing import Literal, Protocol

from app.services.voice import model_catalog, pocket_tts_engine, tts_engine, voices

TtsEngineName = Literal["kokoro", "pocket"]
# Pocket TTS is what the app speaks with: measured at 1.03s to first audio
# against Kokoro's 2.22s, and crucially at ~0.53x real time where Kokoro
# drifts above 1.0x and starts leaving gaps in long replies.
DEFAULT_ENGINE: TtsEngineName = "pocket"
ENGINE_NAMES: tuple[TtsEngineName, ...] = ("kokoro", "pocket")

ENGINE_LABELS: dict[str, str] = {
    "kokoro": "Kokoro",
    "pocket": "Pocket TTS (Kyutai)",
}


class TtsEngine(Protocol):
    def is_ready(self) -> bool: ...
    def warm_up(self) -> None: ...
    def unload(self) -> None: ...
    def split_for_streaming(self, text: str) -> list[str]: ...
    def synthesize(self, text: str, voice: str | None = None) -> bytes: ...


_ENGINES: dict[str, object] = {"kokoro": tts_engine, "pocket": pocket_tts_engine}


def normalise(name: str | None) -> TtsEngineName:
    return name if name in ENGINE_NAMES else DEFAULT_ENGINE  # type: ignore[return-value]


def engine_for(name: str | None):
    """The module implementing the named engine, falling back to the default
    rather than raising — an unrecognised value in the column (a downgrade, a
    hand-edited DB) should still produce speech, not a 500."""
    return _ENGINES[normalise(name)]


def selected_name(conn: sqlite3.Connection, user_id: str) -> TtsEngineName:
    row = conn.execute("SELECT tts_engine FROM user_settings WHERE user_id = ?", (user_id,)).fetchone()
    return normalise(row["tts_engine"] if row else None)


def selected(conn: sqlite3.Connection, user_id: str):
    return engine_for(selected_name(conn, user_id))


def chosen_voice(conn: sqlite3.Connection, user_id: str, engine: str | None = None) -> str:
    """The voice the learner picked for `engine` (their selected engine when
    None), whether or not it can speak yet. What Settings shows as chosen."""
    name = normalise(engine) if engine else selected_name(conn, user_id)
    column = voices.COLUMN[name]
    row = conn.execute(f"SELECT {column} FROM user_settings WHERE user_id = ?", (user_id,)).fetchone()
    return voices.normalise(name, row[column] if row else None)


def selected_voice(conn: sqlite3.Connection, user_id: str, engine: str | None = None) -> str:
    """The voice to actually speak in. The same as chosen_voice, except while a
    newly picked Pocket voice is still downloading: speech then carries on in
    the default voice instead of failing until the file lands."""
    name = normalise(engine) if engine else selected_name(conn, user_id)
    voice = chosen_voice(conn, user_id, name)
    return voice if voices.is_downloaded(name, voice) else voices.DEFAULT[name]


def set_voice(conn: sqlite3.Connection, user_id: str, engine: str, voice: str) -> None:
    name = normalise(engine)
    if voices.find(name, voice) is None:
        raise ValueError(f"unknown {name} voice: {voice}")
    column = voices.COLUMN[name]
    conn.execute(
        f"""
        INSERT INTO user_settings (user_id, {column}) VALUES (?, ?)
        ON CONFLICT(user_id) DO UPDATE SET {column} = excluded.{column}
        """,
        (user_id, voice),
    )


def is_downloaded(name: str | None) -> bool:
    return (
        model_catalog.pocket_tts_is_downloaded()
        if normalise(name) == "pocket"
        else model_catalog.tts_is_downloaded()
    )


def is_installed(name: str | None) -> bool:
    """Kokoro's runtime is a required dependency; Pocket TTS's is an extra."""
    return pocket_tts_engine.is_installed() if normalise(name) == "pocket" else True


def any_ready() -> bool:
    """Whether *some* voice is resident. The global AI indicator asks about
    memory in general, not about the engine this user happens to have picked,
    so switching engines mustn't make an already-loaded voice read as unloaded
    while its RAM is still held."""
    return tts_engine.is_ready() or pocket_tts_engine.is_ready()


def unload_all() -> None:
    """Frees whichever voice is resident. Used by the global unload and when
    switching engines — the outgoing engine's memory is exactly what the
    incoming one needs."""
    tts_engine.unload()
    pocket_tts_engine.unload()
