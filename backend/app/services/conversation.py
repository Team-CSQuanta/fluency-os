"""Session/turn orchestration for the Conversation feature: real target-word
selection, real local LLM chat generation, real STT/TTS on the voice
channel, and real post-chat analytics + review_logs writes.

Target-word selection is an honest substitute for real SRS "due" scheduling
(which doesn't exist anywhere in this app yet, see 0006_vocabulary.sql):
words with no conversation usage yet are preferred, tie-broken by most
recently saved.
"""

import json
import sqlite3
from datetime import datetime
from pathlib import Path

from app.config import settings
from app.services.voice import (
    cloud_llm_engine,
    engine_status,
    llm_chat_engine,
    model_catalog,
    model_manager,
    stt_engine,
    tts_engine,
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
    over OpenRouter (no local load step — a live API call every time).

    Shape: {"provider": "local", "option": LlmOption} or
           {"provider": "cloud", "model": str, "api_key": str | None}.
    `llm_model_id` is intentionally NOT reused for the OpenRouter model
    string — it stays local-catalog-key-only, so a cloud model id can never
    be misread as a local one (see 0010_openrouter_llm.sql)."""
    row = conn.execute(
        "SELECT llm_mode, openrouter_api_key, openrouter_model FROM user_settings WHERE user_id = ?", (user_id,)
    ).fetchone()
    if row is not None and row["llm_mode"] == "api":
        return {
            "provider": "cloud",
            "model": row["openrouter_model"] or cloud_llm_engine.DEFAULT_MODEL,
            "api_key": row["openrouter_api_key"],
        }
    return {"provider": "local", "option": selected_llm_option(conn, user_id)}


def llm_target_label(target: dict) -> str:
    if target["provider"] == "cloud":
        return f"{target['model']} (OpenRouter)"
    return target["option"].label


def _session_llm_target(conn: sqlite3.Connection, session: sqlite3.Row) -> dict:
    """The model/provider a session should keep using for the rest of its
    turns — consistent history matters more than switching engines partway
    through a conversation, same reasoning as the old local-only version of
    this function. `model_id` encodes provider: a local catalog key as
    before, or "cloud:<openrouter model>" for a session started on the
    cloud provider. A session with no model_id (genuinely old, or
    interrupted before start_session finished) falls back to the user's
    *current* preference rather than a fixed default."""
    model_id = session["model_id"]
    if model_id and model_id.startswith("cloud:"):
        row = conn.execute(
            "SELECT openrouter_api_key FROM user_settings WHERE user_id = ?", (session["user_id"],)
        ).fetchone()
        return {
            "provider": "cloud",
            "model": model_id[len("cloud:") :],
            "api_key": row["openrouter_api_key"] if row else None,
        }
    if model_id:
        return {"provider": "local", "option": model_catalog.llm_option(model_id)}
    return llm_target(conn, session["user_id"])


def _session_model_id(target: dict) -> str:
    return f"cloud:{target['model']}" if target["provider"] == "cloud" else target["option"].key


def _generate_reply(target: dict, system_prompt: str, history: list[tuple[str, str]], max_tokens: int = 220) -> str:
    if target["provider"] == "cloud":
        return cloud_llm_engine.generate_reply(
            system_prompt, history, api_key=target["api_key"], model=target["model"], max_tokens=max_tokens
        )
    option = target["option"]
    return llm_chat_engine.generate_reply(
        system_prompt, history, repo_id=option.repo_id, filename=option.filename, max_tokens=max_tokens
    )


def _generate_report(target: dict, transcript: list[tuple[str, str]], target_words: list[str]) -> dict:
    if target["provider"] == "cloud":
        return cloud_llm_engine.generate_report(
            transcript, target_words, api_key=target["api_key"], model=target["model"]
        )
    option = target["option"]
    return llm_chat_engine.generate_report(transcript, target_words, repo_id=option.repo_id, filename=option.filename)


def _readiness_for_target(target: dict, channel: str) -> dict:
    if target["provider"] == "cloud":
        llm_ready = bool(target["api_key"])
    else:
        llm_ready = model_catalog.llm_is_downloaded(target["option"])
    if channel == "voice":
        stt_ready = model_catalog.stt_is_downloaded()
        tts_ready = model_catalog.tts_is_downloaded()
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
    return _readiness_for_target(llm_target(conn, user_id), channel)


def _ensure_ready_for_target(target: dict, channel: str) -> None:
    r = _readiness_for_target(target, channel)
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
    _ensure_ready_for_target(llm_target(conn, user_id), channel)


def full_engine_status(conn: sqlite3.Connection, user_id: str) -> dict:
    """Like engine_status.status(), but provider-aware: the cloud LLM has no
    local "loaded into memory" concept, so it reads as ready the instant an
    API key is configured, rather than through the local model-residency
    check (which would otherwise always show not_loaded for it)."""
    target = llm_target(conn, user_id)
    if target["provider"] == "cloud":
        st = engine_status.status(None)
        st["llm"] = "ready" if target["api_key"] else "not_loaded"
        return st
    option = target["option"]
    return engine_status.status(str(model_manager.llm_model_path(option.repo_id, option.filename)))


def _ensure_launched(needs: set[str], *, llm_target: dict) -> None:
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
    if llm_target["provider"] == "cloud":
        effective_needs.discard("llm")
    else:
        option = llm_target["option"]
        llm_path = str(model_manager.llm_model_path(option.repo_id, option.filename))
    st = engine_status.status(llm_path)
    missing = sorted(n.upper() for n in effective_needs if st.get(n) != "ready")
    if missing:
        raise EngineUnavailable(
            f"AI isn't launched yet ({'/'.join(missing)} not loaded) — "
            "use the Launch AI button at the top of the app, then try again."
        )


def _select_target_words(conn: sqlite3.Connection, user_id: str) -> list[sqlite3.Row]:
    return conn.execute(
        """
        SELECT vw.id, vw.word, vw.definition,
               (SELECT COUNT(*) FROM review_logs rl WHERE rl.vocab_word_id = vw.id) AS usage_count
        FROM vocab_words vw
        WHERE vw.user_id = ?
        ORDER BY usage_count ASC, vw.created_at DESC
        LIMIT ?
        """,
        (user_id, TARGET_WORD_COUNT),
    ).fetchall()


def _system_prompt(scenario: str, target_words: list[sqlite3.Row]) -> str:
    scenario_cfg = SCENARIOS[scenario]
    words_block = (
        "\n".join(f"- {w['word']}: {w['definition'] or 'no definition on file'}" for w in target_words)
        or "(the learner has no saved vocabulary yet — just have a natural conversation)"
    )
    return (
        f"You are Juno, a friendly AI conversation partner helping someone practice English. "
        f"Scenario: {scenario_cfg['brief']}\n\n"
        f"The learner is trying to use these target words naturally in this conversation:\n{words_block}\n\n"
        "Rules: never say a target word yourself before the learner does. Keep replies short and "
        "natural (2-4 sentences), like real spoken conversation, not an essay. Ask a follow-up question "
        "to keep the conversation going."
    )


def launch_engines(conn: sqlite3.Connection, user_id: str) -> dict:
    """The "Launch AI" action: explicitly loads whatever's downloaded into
    memory right now, instead of leaving that to happen (or be refused, per
    _ensure_launched) at first real use. The cloud provider has nothing to
    load for the LLM itself — just needs a configured key — but voice's
    local STT/TTS still get warmed up either way."""
    target = llm_target(conn, user_id)
    if target["provider"] == "local":
        if not model_catalog.llm_is_downloaded(target["option"]):
            raise EngineUnavailable("No AI model downloaded yet — download one in Settings before launching AI.")
        llm_chat_engine.warm_up(target["option"].repo_id, target["option"].filename)
    elif not target["api_key"]:
        raise EngineUnavailable("No OpenRouter API key configured — add one in Settings before launching AI.")
    if model_catalog.stt_is_downloaded():
        stt_engine.warm_up()
    if model_catalog.tts_is_downloaded():
        tts_engine.warm_up()
    return full_engine_status(conn, user_id)


def start_session(conn: sqlite3.Connection, *, user_id: str, scenario: str, channel: str) -> str:
    _ensure_ready(conn, user_id, channel)
    target = llm_target(conn, user_id)
    _ensure_launched({"llm"} | ({"tts"} if channel == "voice" else set()), llm_target=target)

    target_words = _select_target_words(conn, user_id)
    session_id = uuid7()
    now = iso8601_utc_now()

    conn.execute(
        """
        INSERT INTO conversation_sessions (id, user_id, scenario, channel, target_word_ids, model_id, started_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (session_id, user_id, scenario, channel, json.dumps([w["id"] for w in target_words]), _session_model_id(target), now),
    )
    # Commit before the slow LLM call below — otherwise this write
    # transaction stays open (blocking every other writer) for however long
    # the model takes to reply, which can be minutes on a cold first load.
    conn.commit()

    system_prompt = _system_prompt(scenario, target_words)
    opening = _generate_reply(
        target,
        system_prompt,
        [("user", "(The learner has just joined. Greet them and open the conversation.)")],
    )
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
) -> sqlite3.Row:
    turn_id = uuid7()
    audio_path = None
    if channel == "voice" and speaker == "ai":
        wav_bytes = tts_engine.synthesize(text)
        audio_path = str(_audio_dir() / f"{turn_id}.wav")
        Path(audio_path).write_bytes(wav_bytes)

    conn.execute(
        """
        INSERT INTO conversation_turns (id, session_id, turn_index, speaker, text, audio_path, stt_confidence, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (turn_id, session_id, turn_index, speaker, text, audio_path, stt_confidence, iso8601_utc_now()),
    )
    conn.commit()
    return conn.execute("SELECT * FROM conversation_turns WHERE id = ?", (turn_id,)).fetchone()


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
    _ensure_ready_for_target(target, channel)
    _ensure_launched(
        {"llm"} | ({"stt"} if audio_bytes is not None else set()) | ({"tts"} if channel == "voice" else set()),
        llm_target=target,
    )
    stt_confidence = None
    if audio_bytes is not None:
        text, stt_confidence = stt_engine.transcribe(audio_bytes)

    text = (text or "").strip()
    turns = get_turns(conn, session["id"])
    next_index = turns[-1]["turn_index"] + 1 if turns else 0

    user_turn = _insert_turn(conn, session["id"], next_index, "user", text, channel, stt_confidence)

    target_words = conn.execute(
        f"SELECT id, word, definition FROM vocab_words WHERE id IN "
        f"({','.join('?' for _ in json.loads(session['target_word_ids']))})",
        json.loads(session["target_word_ids"]),
    ).fetchall() if json.loads(session["target_word_ids"]) else []

    system_prompt = _system_prompt(session["scenario"], target_words)
    history = [("assistant" if t["speaker"] == "ai" else "user", t["text"]) for t in [*turns, user_turn]]
    reply = _generate_reply(target, system_prompt, history)
    ai_turn = _insert_turn(conn, session["id"], next_index + 1, "ai", reply, channel)

    return user_turn, ai_turn


def _parse_ts(ts: str) -> datetime:
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


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
    analysis = _generate_report(target, transcript, [w["word"] for w in target_words])

    word_usage: dict[str, str] = analysis.get("word_usage", {}) or {}
    fluency_score = int(analysis.get("fluency_score", 0) or 0)
    vocabulary_reach_score = int(analysis.get("vocabulary_reach_score", 0) or 0)
    self_corrections = int(analysis.get("self_corrections", 0) or 0)
    raw_errors = analysis.get("errors", []) or []
    summary = str(analysis.get("summary", "")) or "No summary was generated."

    user_turns = [t for t in turns if t["speaker"] == "user"]
    total_words_spoken = sum(len(t["text"].split()) for t in user_turns)
    if len(turns) >= 2:
        started = _parse_ts(turns[0]["created_at"])
        ended = _parse_ts(turns[-1]["created_at"])
        elapsed_minutes = max((ended - started).total_seconds() / 60.0, 1 / 60.0)
    else:
        elapsed_minutes = 1 / 60.0
    words_per_minute = round(total_words_spoken / elapsed_minutes)

    gaps = []
    for prev, cur in zip(turns, turns[1:]):
        gaps.append((_parse_ts(cur["created_at"]) - _parse_ts(prev["created_at"])).total_seconds())
    avg_pause_seconds = round(sum(gaps) / len(gaps), 1) if gaps else 0.0

    confidences = [t["stt_confidence"] for t in user_turns if t["stt_confidence"] is not None]
    pronunciation_score = round(100 * sum(confidences) / len(confidences)) if confidences else None

    routing = []
    outcomes_for_logs: list[tuple[str, str]] = []
    for w in target_words:
        outcome = word_usage.get(w["word"], "avoided")
        if outcome not in ("spontaneous", "prompted", "incorrect", "avoided"):
            outcome = "avoided"
        evidence_turn = next(
            (t["turn_index"] for t in user_turns if w["word"].lower() in t["text"].lower()), None
        )
        routing.append({"word": w["word"], "outcome": outcome, "evidence_turn": evidence_turn})
        outcomes_for_logs.append((w["id"], outcome))

    correct_count = sum(1 for r in routing if r["outcome"] in ("spontaneous", "prompted"))
    contextual_accuracy_pct = round(100 * correct_count / len(routing)) if routing else 0

    errors = [
        {"bad": e.get("bad", ""), "good": e.get("good", ""), "why": e.get("why", "")}
        for e in raw_errors[:5]
        if isinstance(e, dict)
    ]

    report = {
        "session_id": session["id"],
        "contextual_accuracy_pct": contextual_accuracy_pct,
        "fluency_score": fluency_score,
        "vocabulary_reach_score": vocabulary_reach_score,
        "pronunciation_score": pronunciation_score,
        "words_per_minute": words_per_minute,
        "avg_pause_seconds": avg_pause_seconds,
        "self_corrections": self_corrections,
        "turn_count": len(turns),
        "routing": routing,
        "errors": errors,
        "summary": summary,
    }

    now = iso8601_utc_now()
    conn.execute(
        "UPDATE conversation_sessions SET report_json = ?, ended_at = ? WHERE id = ?",
        (json.dumps(report), now, session["id"]),
    )
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

    for turn in conn.execute("SELECT audio_path FROM conversation_turns WHERE session_id = ?", (session_id,)):
        if turn["audio_path"]:
            Path(turn["audio_path"]).unlink(missing_ok=True)

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
