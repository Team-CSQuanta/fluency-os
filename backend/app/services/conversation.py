"""Session/turn orchestration for the Conversation feature: real target-word
selection, real local LLM chat generation, real STT/TTS on the voice
channel, and real post-chat analytics + review_logs writes.

Target-word selection is an honest substitute for real SRS "due" scheduling
(which doesn't exist anywhere in this app yet, see 0006_vocabulary.sql):
words with no conversation usage yet are preferred, tie-broken by most
recently saved.
"""

import json
import os
import sqlite3
from pathlib import Path

from pydantic import ValidationError

from app.config import settings
from app.services import conversation_report
from app.services.voice import (
    cloud_llm_engine,
    engine_health,
    engine_status,
    gemini_llm_engine,
    llm_chat_engine,
    model_catalog,
    model_manager,
    stt_engine,
    tts,
)
from app.services.voice.errors import EngineUnavailable
from app.utils.ids import uuid7
from app.utils.time import iso8601_utc_now

TARGET_WORD_COUNT = 8

SCENARIOS: dict[str, dict[str, str]] = {
    "free": {
        "label": "Free talk",
        "brief": "An open, casual conversation about whatever comes up — the learner's week, opinions, small updates.",
    },
    "coffee": {
        "label": "Order coffee",
        "brief": "You are a barista at a coffee shop. Stay in character; take the learner's order, ask natural follow-ups (size, milk, name for the cup).",
    },
    "job": {
        "label": "Job interview",
        "brief": "You are interviewing the learner for a job they're applying to. Ask realistic interview questions and react to their answers.",
    },
    "debate": {
        "label": "Debate a topic",
        "brief": "Pick a everyday debatable topic and take a clear side, pushing back on the learner's points respectfully.",
    },
}


def _audio_dir() -> Path:
    d = Path(settings.db_path).resolve().parent / "conversation_audio"
    d.mkdir(parents=True, exist_ok=True)
    return d


def selected_llm_option(conn: sqlite3.Connection, user_id: str) -> model_catalog.LlmOption:
    row = conn.execute("SELECT llm_model_id FROM user_settings WHERE user_id = ?", (user_id,)).fetchone()
    explicit_key = row["llm_model_id"] if row else None
    if explicit_key:
        return model_catalog.llm_option(explicit_key)

    # No explicit choice made yet in Settings — prefer whichever option is
    # actually downloaded rather than blindly falling back to the catalog's
    # fixed recommended default, which may not be the one the user has. This
    # keeps "download a model" alone sufficient to unblock Conversation, with
    # no separate "now go select it" step required.
    for option in model_catalog.LLM_OPTIONS:
        if model_catalog.llm_is_downloaded(option):
            return option
    return model_catalog.llm_option(None)


def llm_target(conn: sqlite3.Connection, user_id: str) -> dict:
    """Resolves what a real LLM call should actually hit right now: either a
    local catalog option (llama.cpp, loaded via Launch AI) or a cloud model
    over OpenRouter or Gemini (no local load step — a live API call every
    time either way).

    Shape: {"provider": "local", "option": LlmOption} or
           {"provider": "openrouter" | "gemini", "model": str, "api_key": str | None}.
    `llm_model_id` is intentionally NOT reused for a cloud model string — it
    stays local-catalog-key-only, so a cloud model id can never be misread as
    a local one (see 0010_openrouter_llm.sql). `api_provider` picks which
    cloud service 'api' mode actually means (see 0011_gemini_llm.sql)."""
    row = conn.execute(
        "SELECT llm_mode, api_provider, openrouter_api_key, openrouter_model, gemini_api_key, gemini_model "
        "FROM user_settings WHERE user_id = ?",
        (user_id,),
    ).fetchone()
    if row is not None and row["llm_mode"] == "api":
        if row["api_provider"] == "gemini":
            return {
                "provider": "gemini",
                "model": row["gemini_model"] or gemini_llm_engine.DEFAULT_MODEL,
                "api_key": row["gemini_api_key"],
            }
        return {
            "provider": "openrouter",
            "model": row["openrouter_model"] or cloud_llm_engine.DEFAULT_MODEL,
            "api_key": row["openrouter_api_key"],
        }
    return {"provider": "local", "option": selected_llm_option(conn, user_id)}


def llm_target_label(target: dict) -> str:
    if target["provider"] == "openrouter":
        return f"{target['model']} (OpenRouter)"
    if target["provider"] == "gemini":
        return f"{target['model']} (Gemini)"
    return target["option"].label


def _session_llm_target(conn: sqlite3.Connection, session: sqlite3.Row) -> dict:
    """A conversation follows whatever engine Settings currently points at, so
    switching model or provider takes effect on the chat already open instead
    of only on the next one.

    Sessions used to be pinned to the engine they started on, for consistent
    voice across a transcript. In practice that traded a cosmetic consistency
    for a real dead end: when the pinned engine became unusable (quota spent,
    key revoked, model deleted) the conversation could never continue, and no
    Settings change could rescue it. `model_id` now records what most recently
    answered rather than dictating what must answer next."""
    return llm_target(conn, session["user_id"])


def session_engine(conn: sqlite3.Connection, session: sqlite3.Row) -> dict:
    """The engine this session's next turn will really call, named for the UI
    so it can show the truth instead of inferring it from global state (which
    is how it ended up claiming one engine while the turns called another)."""
    target = _session_llm_target(conn, session)
    return {"provider": target["provider"], "label": llm_target_label(target)}


def _session_model_id(target: dict) -> str:
    if target["provider"] == "gemini":
        return f"cloud:gemini:{target['model']}"
    if target["provider"] == "openrouter":
        return f"cloud:{target['model']}"
    return target["option"].key


def _cloud_engine(provider: str):
    return gemini_llm_engine if provider == "gemini" else cloud_llm_engine


def _generate_reply(target: dict, system_prompt: str, history: list[tuple[str, str]], max_tokens: int = 120) -> str:
    if target["provider"] != "local":
        return _cloud_engine(target["provider"]).generate_reply(
            system_prompt, history, api_key=target["api_key"], model=target["model"], max_tokens=max_tokens
        )
    option = target["option"]
    return llm_chat_engine.generate_reply(
        system_prompt, history, repo_id=option.repo_id, filename=option.filename, max_tokens=max_tokens
    )


def _generate_analysis(
    target: dict, transcript: list[tuple[str, str]], target_words: list[str]
) -> conversation_report.LlmReportAnalysis:
    """The judged half of the report. Prompt and parsing both come from
    conversation_report, so the keys asked for are by construction the keys
    read back — see that module's docstring for what went wrong when they
    were maintained separately."""
    system_prompt = conversation_report.report_system_prompt(target_words)
    user_prompt = conversation_report.report_user_prompt(transcript)

    if target["provider"] != "local":
        raw = _cloud_engine(target["provider"]).generate_json(
            system_prompt, user_prompt, api_key=target["api_key"], model=target["model"], max_tokens=700
        )
    else:
        option = target["option"]
        raw = llm_chat_engine.generate_json(
            system_prompt, user_prompt, repo_id=option.repo_id, filename=option.filename, max_tokens=700
        )
    # A small model will sometimes omit a key or mistype a value; a partial
    # analysis is still worth showing, so tolerate that rather than failing the
    # whole report. What it cannot do is invent a field nobody asked for.
    try:
        return conversation_report.LlmReportAnalysis.model_validate(raw)
    except ValidationError:
        return conversation_report.LlmReportAnalysis()


def _readiness_for_target(target: dict, channel: str, tts_name: str = tts.DEFAULT_ENGINE) -> dict:
    if target["provider"] == "local":
        llm_ready = model_catalog.llm_is_downloaded(target["option"])
    else:
        llm_ready = bool(target["api_key"])
    if channel == "voice":
        stt_ready = model_catalog.stt_is_downloaded()
        # Only the *selected* voice engine has to be downloaded. Having
        # Kokoro on disk says nothing about whether Pocket TTS is, and a
        # session that would fail on the engine it will actually use should
        # say so up front rather than at the first attempt to speak.
        tts_ready = tts.is_downloaded(tts_name)
    else:
        stt_ready = tts_ready = True
    return {
        "ready": llm_ready and stt_ready and tts_ready,
        "llm": llm_ready,
        "stt": stt_ready,
        "tts": tts_ready,
        "llm_model_label": llm_target_label(target),
    }


def readiness(conn: sqlite3.Connection, user_id: str, channel: str) -> dict:
    """What a session needs before it can actually run — checked up front so
    Conversation can refuse to start with a clear message instead of the old
    behavior of silently kicking off a multi-minute implicit download (or
    now, failing deep inside an HTTP request). For the cloud provider,
    "ready" means a real API key is configured — there's no download step.
    Reflects the user's *current* Settings preference — see
    _ensure_ready_for_target for the session-pinned equivalent."""
    return _readiness_for_target(llm_target(conn, user_id), channel, tts.selected_name(conn, user_id))


def _ensure_ready_for_target(target: dict, channel: str, tts_name: str = tts.DEFAULT_ENGINE) -> None:
    r = _readiness_for_target(target, channel, tts_name)
    if r["ready"]:
        return
    missing = [name for name, ok in (("LLM", r["llm"]), ("STT", r["stt"]), ("TTS", r["tts"])) if not ok]
    raise EngineUnavailable(
        f"{'/'.join(missing)} model{'s' if len(missing) > 1 else ''} not downloaded yet — "
        "download it in Settings before starting a conversation."
    )


def _ensure_ready(conn: sqlite3.Connection, user_id: str, channel: str) -> None:
    """Checks the user's *current* Settings preference — right for
    start_session (no session exists yet). submit_user_turn/end_session use
    _ensure_ready_for_target with the session's own pinned target instead,
    so switching Settings mid-conversation (e.g. back to local with nothing
    downloaded) can't block turns in a session that's still perfectly able
    to run on what it was actually started with."""
    _ensure_ready_for_target(llm_target(conn, user_id), channel, tts.selected_name(conn, user_id))


def full_engine_status(conn: sqlite3.Connection, user_id: str) -> dict:
    """Like engine_status.status(), but provider-aware: the cloud LLM has no
    local "loaded into memory" concept, so it reads as ready the instant an
    API key is configured, rather than through the local model-residency
    check (which would otherwise always show not_loaded for it)."""
    target = llm_target(conn, user_id)
    if target["provider"] != "local":
        st = engine_status.status(None)
        # A saved key is not a working key. "ready" here means a real request
        # has actually succeeded — established by Launch AI, and revoked again
        # the moment one genuinely fails. Read from a record rather than probed
        # here, so polling this endpoint never spends quota.
        st["llm"] = (
            "ready"
            if target["api_key"] and engine_health.is_verified(target["provider"], target["model"])
            else "not_loaded"
        )
        return st
    option = target["option"]
    return engine_status.status(str(model_manager.llm_model_path(option.repo_id, option.filename)))


def _ensure_launched(needs: set[str], *, llm_target: dict, tts_name: str | None = None) -> None:
    """Distinct from _ensure_ready: that checks a model is *downloaded*/
    *configured*, this checks it's actually *loaded into memory* — a check
    that only applies to the local provider, since a cloud API call has no
    load step at all (once _ensure_ready confirmed a key exists, it's
    already "launched"). For local, this is pinned to whichever model
    `llm_target` says is actually selected right now — without that,
    switching to a different (downloaded) model in Settings would still
    read as "ready" off whatever was previously loaded, and the next turn
    would silently pay a reload mid-conversation instead of the learner
    choosing when via Launch AI."""
    effective_needs = set(needs)
    llm_path = None
    if llm_target["provider"] != "local":
        effective_needs.discard("llm")
    else:
        option = llm_target["option"]
        llm_path = str(model_manager.llm_model_path(option.repo_id, option.filename))
    st = engine_status.status(llm_path, tts_name)
    missing = sorted(n.upper() for n in effective_needs if st.get(n) != "ready")
    if missing:
        raise EngineUnavailable(
            f"AI isn't launched yet ({'/'.join(missing)} not loaded) — "
            "use the Launch AI button at the top of the app, then try again."
        )


def _select_target_words(conn: sqlite3.Connection, user_id: str) -> list[sqlite3.Row]:
    """An 'avoided' log means the word was offered as a target but the learner
    never actually said it — counting that as practice would push exactly the
    words that still need work to the back of the queue, so only outcomes
    where the word was really produced count as usage here."""
    return conn.execute(
        """
        SELECT vw.id, vw.word, vw.definition,
               (SELECT COUNT(*) FROM review_logs rl
                 WHERE rl.vocab_word_id = vw.id AND rl.outcome <> 'avoided') AS usage_count
        FROM vocab_words vw
        WHERE vw.user_id = ?
        ORDER BY usage_count ASC, vw.created_at DESC
        LIMIT ?
        """,
        (user_id, TARGET_WORD_COUNT),
    ).fetchall()


def _words_by_ids(conn: sqlite3.Connection, user_id: str, word_ids: list[str]) -> list[sqlite3.Row]:
    """Scoped to the owner, so a seeded id can't pull in someone else's word.
    Silently drops ids that no longer exist — a word deleted since the original
    session shouldn't block repeating it."""
    if not word_ids:
        return []
    placeholders = ",".join("?" for _ in word_ids)
    return conn.execute(
        f"SELECT id, word, definition FROM vocab_words WHERE user_id = ? AND id IN ({placeholders})",
        [user_id, *word_ids],
    ).fetchall()


def normalise_for_chat(pairs: list[tuple[str, str]]) -> tuple[list[str], list[tuple[str, str]]]:
    """Reshape a transcript into something every provider will accept.

    Returns (assistant_opening_lines, history), where history begins with a
    'user' message and strictly alternates user/assistant.

    Two real failures make this necessary, both observed in production:

    1. **A session opens with the AI speaking.** Gemma's chat template rejects
       that outright — measured against gemma-3-1b, ``system + assistant +
       user`` raises "Conversation roles must alternate
       user/assistant/user/assistant/...", while ``system + user + assistant +
       user`` is fine. So every reply after the AI greeting failed on any
       Gemma model. Leading assistant turns are lifted out here and handed to
       the caller to fold into the system prompt, which keeps their content
       without breaking the alternation rule. Gemini requires the same shape.

    2. **Consecutive turns from one speaker.** A failed generation used to
       leave the learner's turn committed with no reply, so the next attempt
       saw two user turns in a row and hit the same template error — the
       error then masked whatever had actually gone wrong. Orphans are no
       longer created (see submit_user_turn), but sessions already in that
       state still have to work, so same-role runs are merged into one
       message rather than dropped.
    """
    merged: list[tuple[str, str]] = []
    for role, text in pairs:
        clean = (text or "").strip()
        if not clean:
            continue
        if merged and merged[-1][0] == role:
            merged[-1] = (role, f"{merged[-1][1]} {clean}")
        else:
            merged.append((role, clean))

    opening: list[str] = []
    while merged and merged[0][0] == "assistant":
        opening.append(merged.pop(0)[1])
    return opening, merged


def _system_prompt(
    scenario: str, target_words: list[sqlite3.Row], opening: list[str] | None = None
) -> str:
    scenario_cfg = SCENARIOS[scenario]
    words_block = (
        "\n".join(f"- {w['word']}: {w['definition'] or 'no definition on file'}" for w in target_words)
        or "(the learner has no saved vocabulary yet — just have a natural conversation)"
    )
    return (
        f"You are Juno, a friendly AI conversation partner helping someone practice English. "
        f"Scenario: {scenario_cfg['brief']}\n\n"
        f"The learner is trying to use these target words naturally in this conversation:\n{words_block}\n\n"
        "Rules: never say a target word yourself before the learner does. Keep replies to ONE or TWO "
        "short sentences — real spoken conversation, not an essay. Speaking them aloud takes longer "
        "than generating them, so length is what the learner waits on. Ask a follow-up question to "
        "keep the conversation going."
        # Whatever the AI already said cannot stay in the message list without
        # breaking alternation (see normalise_for_chat), so it is given back
        # here instead — the model still knows how it opened.
        + (f"\n\nYou have already said this to the learner: {' '.join(opening)}" if opening else "")
    )


def launch_engines(conn: sqlite3.Connection, user_id: str) -> dict:
    """The "Launch AI" action: explicitly loads whatever's downloaded into
    memory right now, instead of leaving that to happen (or be refused, per
    _ensure_launched) at first real use. Cloud providers have nothing to load
    for the LLM itself — just need a configured key — but voice's local
    STT/TTS still get warmed up either way."""
    target = llm_target(conn, user_id)
    if target["provider"] == "local":
        if not model_catalog.llm_is_downloaded(target["option"]):
            raise EngineUnavailable("No AI model downloaded yet — download one in Settings before launching AI.")
        llm_chat_engine.warm_up(target["option"].repo_id, target["option"].filename)
    elif not target["api_key"]:
        label = "Gemini" if target["provider"] == "gemini" else "OpenRouter"
        raise EngineUnavailable(f"No {label} API key configured — add one in Settings before launching AI.")
    else:
        # The cloud equivalent of loading a model: spend one small request to
        # establish that the key really works, instead of assuming it from the
        # fact that something is saved.
        _cloud_engine(target["provider"]).verify(api_key=target["api_key"], model=target["model"])
    if model_catalog.stt_is_downloaded():
        stt_engine.warm_up()
    tts_name = tts.selected_name(conn, user_id)
    if tts.is_downloaded(tts_name):
        # Whichever engine this user has picked — warming the other one would
        # hold a few hundred MB for a voice that is never going to be called.
        tts.engine_for(tts_name).warm_up()
    return full_engine_status(conn, user_id)


def unload_engines(conn: sqlite3.Connection, user_id: str) -> dict:
    """The opposite of launch_engines: hands the memory back.

    Each engine's own unload() takes the same lock generation holds, so this
    waits for any in-flight turn rather than pulling a model out from under
    it. A cloud LLM has nothing resident to free — its key stays verified, so
    the conversation can carry on while the local speech models are released."""
    target = llm_target(conn, user_id)
    if target["provider"] == "local":
        llm_chat_engine.unload()
    stt_engine.unload()
    tts.unload_all()
    return full_engine_status(conn, user_id)


def start_session(
    conn: sqlite3.Connection,
    *,
    user_id: str,
    scenario: str,
    channel: str,
    seed_word_ids: list[str] | None = None,
) -> str:
    """`seed_word_ids` backs "practise this again": rather than picking a fresh
    set, the new session reuses the words from the one being repeated, so the
    words that just went badly are the ones that come straight back."""
    _ensure_ready(conn, user_id, channel)
    target = llm_target(conn, user_id)
    _ensure_launched(
        {"llm"} | ({"tts"} if channel == "voice" else set()),
        llm_target=target,
        tts_name=tts.selected_name(conn, user_id),
    )

    target_words = _words_by_ids(conn, user_id, seed_word_ids) if seed_word_ids else []
    if not target_words:
        target_words = _select_target_words(conn, user_id)
    # Generate the opening BEFORE writing anything, for two reasons. It keeps
    # a failure from leaving a session row with no turns behind — one that
    # would then sit in the learner's history forever as an empty
    # conversation, and which "resume" could only ever reopen empty. And it
    # means no write transaction is held open across a call that can take
    # minutes on a cold model load, which would block every other writer.
    opening = _generate_reply(
        target,
        _system_prompt(scenario, target_words),
        [("user", "(The learner has just joined. Greet them and open the conversation.)")],
    )

    session_id = uuid7()
    conn.execute(
        """
        INSERT INTO conversation_sessions (id, user_id, scenario, channel, target_word_ids, model_id, started_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            session_id,
            user_id,
            scenario,
            channel,
            json.dumps([w["id"] for w in target_words]),
            _session_model_id(target),
            iso8601_utc_now(),
        ),
    )
    conn.commit()
    _insert_turn(conn, session_id, 0, "ai", opening, channel)
    return session_id


def _insert_turn(
    conn: sqlite3.Connection,
    session_id: str,
    turn_index: int,
    speaker: str,
    text: str,
    channel: str,
    stt_confidence: float | None = None,
    speech_seconds: float | None = None,
) -> sqlite3.Row:
    turn_id = uuid7()
    # Deliberately no synthesis here. Kokoro runs slower than real time on this
    # hardware, so making the whole reply's audio before returning meant the
    # learner waited ~30s to see any reply at all. Audio is produced per
    # sentence, on demand, once the text is already on screen.
    audio_path = None

    conn.execute(
        """
        INSERT INTO conversation_turns
            (id, session_id, turn_index, speaker, text, audio_path, stt_confidence, speech_seconds, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            turn_id,
            session_id,
            turn_index,
            speaker,
            text,
            audio_path,
            stt_confidence,
            speech_seconds,
            iso8601_utc_now(),
        ),
    )
    conn.commit()
    return conn.execute("SELECT * FROM conversation_turns WHERE id = ?", (turn_id,)).fetchone()


def audio_chunk_path(turn_id: str, index: int, engine: str = tts.DEFAULT_ENGINE) -> Path:
    """The engine is part of the filename because the audio is that engine's
    voice. Without it, switching engines would keep serving whatever the
    previous one had already cached for a turn, so the change would appear to
    do nothing on every reply already on screen. It also leaves the two free
    to split replies differently without one's chunk 0 being served as the
    other's."""
    return _audio_dir() / f"{turn_id}.{engine}.{index}.wav"


def ensure_audio_chunk(turn_id: str, text: str, index: int, engine: str = tts.DEFAULT_ENGINE) -> Path:
    """Synthesizes one sentence of a reply, cached on disk after the first
    request. Called when that sentence is about to be played rather than while
    the learner is still waiting to read the reply."""
    name = tts.normalise(engine)
    chunks = tts.engine_for(name).split_for_streaming(text)
    if index < 0 or index >= len(chunks):
        raise IndexError(f"chunk {index} out of range for {len(chunks)} chunks")
    path = audio_chunk_path(turn_id, index, name)
    if not path.exists():
        audio = tts.engine_for(name).synthesize(chunks[index])
        # Written to a private temp file and moved into place, never straight
        # to `path`. The player fetches chunk N+1 while N is still audible, so
        # two requests for the same chunk really can overlap (a replay, a
        # retry, a second window) — and a FileResponse reading a path that
        # another thread is still writing serves a truncated WAV, which plays
        # as a click or as silence. os.replace is atomic, so a reader sees
        # either the whole file or no file.
        tmp = path.with_suffix(f".{uuid7()}.part")
        try:
            tmp.write_bytes(audio)
            os.replace(tmp, path)
        finally:
            tmp.unlink(missing_ok=True)
    return path


def audio_chunk_texts(turn: sqlite3.Row, channel: str, engine: str = tts.DEFAULT_ENGINE) -> list[str]:
    """The text of each audio piece this turn produces, in order. Only the AI
    speaks aloud, and only on the voice channel.

    The client highlights words in time with the voice, which means it needs
    the same split the synthesizer used — not a guess at it. Returning the
    text rather than only a count is what makes the two agree."""
    if channel != "voice" or turn["speaker"] != "ai":
        return []
    return tts.engine_for(engine).split_for_streaming(turn["text"])


def audio_chunk_count(turn: sqlite3.Row, channel: str, engine: str = tts.DEFAULT_ENGINE) -> int:
    """How many audio pieces this turn can produce."""
    return len(audio_chunk_texts(turn, channel, engine))


def get_session_row(conn: sqlite3.Connection, session_id: str, user_id: str) -> sqlite3.Row | None:
    return conn.execute(
        "SELECT * FROM conversation_sessions WHERE id = ? AND user_id = ?", (session_id, user_id)
    ).fetchone()


def get_turns(conn: sqlite3.Connection, session_id: str) -> list[sqlite3.Row]:
    return conn.execute(
        "SELECT * FROM conversation_turns WHERE session_id = ? ORDER BY turn_index", (session_id,)
    ).fetchall()


def submit_user_turn(
    conn: sqlite3.Connection,
    session: sqlite3.Row,
    *,
    text: str | None,
    audio_bytes: bytes | None,
) -> tuple[sqlite3.Row, sqlite3.Row]:
    channel = session["channel"]
    target = _session_llm_target(conn, session)
    _ensure_ready_for_target(target, channel, tts.selected_name(conn, session["user_id"]))
    # Record what is actually answering now, so the session's engine label
    # reflects reality after a mid-conversation switch.
    model_id = _session_model_id(target)
    if session["model_id"] != model_id:
        conn.execute("UPDATE conversation_sessions SET model_id = ? WHERE id = ?", (model_id, session["id"]))
        conn.commit()
    _ensure_launched(
        {"llm"} | ({"stt"} if audio_bytes is not None else set()) | ({"tts"} if channel == "voice" else set()),
        llm_target=target,
        tts_name=tts.selected_name(conn, session["user_id"]),
    )
    stt_confidence = None
    speech_seconds = None
    if audio_bytes is not None:
        text, stt_confidence, speech_seconds = stt_engine.transcribe(audio_bytes)

    text = (text or "").strip()
    if not text:
        # Audio was provided (the router already rejects "neither text nor
        # audio") but STT came back empty — silence, too short a clip, or
        # unclear speech. Sending an empty turn to the LLM isn't meaningful
        # for any provider, and Gemini specifically rejects it outright
        # (its "ends with a model turn" error is really this in disguise:
        # an empty user part gets dropped from validation, leaving the
        # prior AI turn looking like the last one). Fail honestly instead.
        raise ValueError("Didn't catch any speech there — try speaking again, a bit louder or closer to the mic.")
    turns = get_turns(conn, session["id"])
    next_index = turns[-1]["turn_index"] + 1 if turns else 0

    target_words = conn.execute(
        f"SELECT id, word, definition FROM vocab_words WHERE id IN "
        f"({','.join('?' for _ in json.loads(session['target_word_ids']))})",
        json.loads(session["target_word_ids"]),
    ).fetchall() if json.loads(session["target_word_ids"]) else []

    pairs = [("assistant" if t["speaker"] == "ai" else "user", t["text"]) for t in turns]
    pairs.append(("user", text))
    opening, history = normalise_for_chat(pairs)
    system_prompt = _system_prompt(session["scenario"], target_words, opening)

    # Generate BEFORE writing anything. A failure here used to leave the
    # learner's turn committed with no reply, and the next attempt then saw
    # two user turns in a row — which Gemma's template rejects, so the session
    # was permanently stuck behind an alternation error that said nothing
    # about the original failure. Nothing is persisted unless there is a
    # reply to persist alongside it.
    reply = _generate_reply(target, system_prompt, history)

    user_turn = _insert_turn(
        conn, session["id"], next_index, "user", text, channel, stt_confidence, speech_seconds
    )
    ai_turn = _insert_turn(conn, session["id"], next_index + 1, "ai", reply, channel)

    return user_turn, ai_turn


def end_session(conn: sqlite3.Connection, session: sqlite3.Row) -> dict:
    target = _session_llm_target(conn, session)
    _ensure_launched({"llm"}, llm_target=target)
    turns = get_turns(conn, session["id"])
    target_word_ids = json.loads(session["target_word_ids"])
    target_words = (
        conn.execute(
            f"SELECT id, word FROM vocab_words WHERE id IN ({','.join('?' for _ in target_word_ids)})",
            target_word_ids,
        ).fetchall()
        if target_word_ids
        else []
    )

    transcript = [(t["speaker"], t["text"]) for t in turns]
    analysis = _generate_analysis(target, transcript, [w["word"] for w in target_words])

    cefr_row = conn.execute("SELECT cefr_level FROM users WHERE id = ?", (session["user_id"],)).fetchone()
    target_cefr = conversation_report.resolve_cefr(cefr_row["cefr_level"] if cefr_row else None)
    metrics = conversation_report.compute_metrics(turns, target_cefr)

    user_turns = [t for t in turns if t["speaker"] == "user"]
    ai_turns = [t for t in turns if t["speaker"] == "ai"]
    routing = []
    outcomes_for_logs: list[tuple[str, str]] = []
    for w in target_words:
        # Whether the learner said the word at all is a fact about the
        # transcript, not a judgement — so it is established here, not asked.
        evidence_turn = next(
            (t["turn_index"] for t in user_turns if conversation_report.says_word(t["text"], w["word"])),
            None,
        )
        outcome = conversation_report.match_word_usage(analysis.word_usage, w["word"]) or "avoided"

        if evidence_turn is not None and outcome == "avoided":
            # "avoided" means "never used at all", and the transcript shows
            # otherwise — a claim the evidence disproves, so it does not
            # stand. Observed with gemma-3-1b marking every word avoided in a
            # session where the learner had plainly used all three; the report
            # then read 0/3 and the words were logged as unpractised, pushing
            # them back to the front of the queue they had just earned their
            # way out of.
            #
            # Only this one outcome is corrected. "incorrect" is a judgement
            # about *how* the word was used and nothing here can second-guess
            # it; "avoided" is the only verdict that is checkable.
            said_first = any(
                t["turn_index"] < evidence_turn and conversation_report.says_word(t["text"], w["word"])
                for t in ai_turns
            )
            # The spec's own distinction: prompted means used only after the
            # AI said it. That much is visible in the transcript.
            outcome = "prompted" if said_first else "spontaneous"

        routing.append({"word": w["word"], "outcome": outcome, "evidence_turn": evidence_turn})
        outcomes_for_logs.append((w["id"], outcome))

    correct_count = sum(1 for r in routing if r["outcome"] in ("spontaneous", "prompted"))
    # None, not 0: a session with no target words didn't score zero accuracy,
    # it had nothing to be accurate about.
    contextual_accuracy_pct = round(100 * correct_count / len(routing)) if routing else None

    report = {
        "report_version": conversation_report.REPORT_VERSION,
        "session_id": session["id"],
        "contextual_accuracy_pct": contextual_accuracy_pct,
        "grammatical_precision": analysis.grammatical_precision,
        # Type-token ratio is 0-1; the dial needs 0-100.
        "lexical_range": round(100 * metrics.type_token_ratio),
        "pronunciation_score": metrics.pronunciation_score,
        "words_per_minute": metrics.words_per_minute,
        "filler_rate_per_100w": metrics.filler_rate_per_100w,
        "avg_response_delay_seconds": metrics.avg_response_delay_seconds,
        "longest_run_words": metrics.longest_run_words,
        "type_token_ratio": metrics.type_token_ratio,
        "above_level_words": metrics.above_level_words,
        "self_corrections": analysis.self_corrections,
        "turn_count": len(turns),
        "routing": routing,
        "errors": [e.model_dump() for e in analysis.errors[:3]],
        "summary": analysis.summary or "No summary was generated.",
    }

    now = iso8601_utc_now()
    conn.execute(
        "UPDATE conversation_sessions SET report_json = ?, ended_at = ? WHERE id = ?",
        (json.dumps(report), now, session["id"]),
    )
    # Ending recomputes over the WHOLE transcript so far, so a re-end
    # supersedes this session's previous logs rather than adding a second set
    # — appending would make one conversation count twice, both in a word's
    # usage history and in _select_target_words' "not practised yet" ordering.
    conn.execute("DELETE FROM review_logs WHERE session_id = ?", (session["id"],))
    for vocab_word_id, outcome in outcomes_for_logs:
        conn.execute(
            "INSERT INTO review_logs (id, user_id, vocab_word_id, session_id, source, outcome, created_at) "
            "VALUES (?, ?, ?, ?, 'conversation', ?, ?)",
            (uuid7(), session["user_id"], vocab_word_id, session["id"], outcome, now),
        )

    return report


def list_sessions(conn: sqlite3.Connection, user_id: str) -> list[sqlite3.Row]:
    return conn.execute(
        "SELECT * FROM conversation_sessions WHERE user_id = ? ORDER BY started_at DESC", (user_id,)
    ).fetchall()


def delete_session(conn: sqlite3.Connection, user_id: str, session_id: str) -> bool:
    """Deletes a session and its turns (DB cascade handles conversation_turns
    and nulls out review_logs.session_id — the real usage history those rows
    represent outlives the session record itself). Audio files aren't
    covered by any DB cascade, so they're unlinked from disk explicitly
    first."""
    row = conn.execute(
        "SELECT id FROM conversation_sessions WHERE id = ? AND user_id = ?", (session_id, user_id)
    ).fetchone()
    if row is None:
        return False

    for turn in conn.execute("SELECT id, audio_path FROM conversation_turns WHERE session_id = ?", (session_id,)):
        if turn["audio_path"]:
            Path(turn["audio_path"]).unlink(missing_ok=True)
        # Per-sentence audio is written lazily and named off the turn id, so it
        # isn't reachable through audio_path.
        for chunk in _audio_dir().glob(f"{turn['id']}.*.wav"):
            chunk.unlink(missing_ok=True)

    conn.execute("DELETE FROM conversation_sessions WHERE id = ?", (session_id,))
    return True


def word_usage_counts(conn: sqlite3.Connection, vocab_word_id: str) -> dict[str, int]:
    """Real per-outcome usage counts for one word — the visible half of
    Dynamic SRS Routing, surfaced on the Vocabulary entry screen."""
    rows = conn.execute(
        "SELECT outcome, COUNT(*) AS n FROM review_logs WHERE vocab_word_id = ? GROUP BY outcome",
        (vocab_word_id,),
    ).fetchall()
    return {row["outcome"]: row["n"] for row in rows}
