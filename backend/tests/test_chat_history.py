"""Shaping the transcript into something every LLM provider accepts.

These cover a failure that made conversation unusable on every Gemma model:
sessions open with the AI greeting, and Gemma's chat template rejects a
history that starts with an assistant message. Measured against gemma-3-1b —
`system + assistant + user` raises "Conversation roles must alternate
user/assistant/user/assistant/...", `system + user + assistant + user` is
accepted.
"""

import json

import pytest

from app.config import settings
from app.db import get_connection
from app.migrations.runner import run_migrations
from app.services import conversation


def test_leading_ai_greeting_is_lifted_out_of_the_history():
    """The case that broke every Gemma conversation: a session opens with the
    AI speaking, so the first real reply sent assistant-then-user and the
    template refused it."""
    opening, history = conversation.normalise_for_chat(
        [("assistant", "Hey there! Welcome."), ("user", "Thanks")]
    )
    assert opening == ["Hey there! Welcome."]
    assert history == [("user", "Thanks")]


def test_history_always_starts_with_the_learner():
    for pairs in (
        [("assistant", "a"), ("user", "b")],
        [("assistant", "a"), ("assistant", "b"), ("user", "c")],
        [("user", "a")],
    ):
        _, history = conversation.normalise_for_chat(pairs)
        assert history[0][0] == "user", pairs


def test_roles_strictly_alternate_after_normalising():
    _, history = conversation.normalise_for_chat(
        [("assistant", "hi"), ("user", "a"), ("user", "b"), ("assistant", "c"), ("user", "d")]
    )
    roles = [r for r, _ in history]
    assert roles == ["user", "assistant", "user"]
    assert all(roles[i] != roles[i + 1] for i in range(len(roles) - 1))


def test_orphaned_user_turns_are_merged_not_dropped():
    """A session that already accumulated orphans must still work, and the
    learner's words must survive — they are the input the reply answers."""
    _, history = conversation.normalise_for_chat(
        [("assistant", "Hi"), ("user", "Thanks"), ("user", "Thanks."), ("user", "Hey")]
    )
    assert history == [("user", "Thanks Thanks. Hey")]


def test_empty_turns_are_skipped():
    _, history = conversation.normalise_for_chat([("assistant", "Hi"), ("user", "  "), ("user", "ok")])
    assert history == [("user", "ok")]


def test_the_greeting_reaches_the_model_through_the_system_prompt():
    """Lifting it out of the history must not lose it — the model still needs
    to know how it opened, or it will greet the learner twice."""
    prompt = conversation._system_prompt("coffee", [], ["Hey there! Welcome."])
    assert "Hey there! Welcome." in prompt
    assert "already said" in prompt


def test_no_opening_leaves_the_prompt_unchanged():
    assert "already said" not in conversation._system_prompt("coffee", [], [])
    assert "already said" not in conversation._system_prompt("coffee", [], None)


# --- the orphan that caused it ----------------------------------------------

def _fresh_conn(tmp_path):
    settings.db_path = str(tmp_path / "hist.db")
    conn = get_connection()
    run_migrations(conn)
    return conn


def _session_with_opening(conn, monkeypatch):
    conn.execute(
        "INSERT INTO users (id, display_name, native_language, target_language, created_at) "
        "VALUES ('u1', 'T', 'en', 'en', '2026-01-01T00:00:00Z')"
    )
    conn.execute("INSERT INTO user_settings (user_id) VALUES ('u1')")
    conn.commit()
    from app.services.voice import model_catalog, pocket_tts_engine, tts_engine

    monkeypatch.setattr(model_catalog, "llm_is_downloaded", lambda o: True)
    monkeypatch.setattr(model_catalog, "stt_is_downloaded", lambda: True)
    monkeypatch.setattr(model_catalog, "pocket_tts_is_downloaded", lambda: True)
    monkeypatch.setattr(conversation, "_ensure_launched", lambda *a, **kw: None)
    monkeypatch.setattr(tts_engine, "synthesize", lambda t: b"wav")
    monkeypatch.setattr(pocket_tts_engine, "synthesize", lambda t: b"wav")
    monkeypatch.setattr(conversation, "_generate_reply", lambda *a, **kw: "Hello there!")
    sid = conversation.start_session(conn, user_id="u1", scenario="coffee", channel="text")
    return conversation.get_session_row(conn, sid, "u1")


def test_a_failed_reply_leaves_no_orphan_turn(tmp_path, monkeypatch):
    """The bug that poisoned a real session: the learner's turn was committed
    before generation, so a failure left it with no reply. The next attempt
    then sent two user turns in a row and hit an alternation error that said
    nothing about the original failure, and every retry added another orphan."""
    conn = _fresh_conn(tmp_path)
    session = _session_with_opening(conn, monkeypatch)

    from app.services.voice.errors import EngineUnavailable

    def _boom(*a, **kw):
        raise EngineUnavailable("model fell over")

    monkeypatch.setattr(conversation, "_generate_reply", _boom)
    for _ in range(3):
        with pytest.raises(EngineUnavailable):
            conversation.submit_user_turn(conn, session, text="Thanks", audio_bytes=None)

    turns = conversation.get_turns(conn, session["id"])
    assert [t["speaker"] for t in turns] == ["ai"], "a failed reply must persist nothing"


def test_a_successful_turn_still_persists_both_sides(tmp_path, monkeypatch):
    conn = _fresh_conn(tmp_path)
    session = _session_with_opening(conn, monkeypatch)
    monkeypatch.setattr(conversation, "_generate_reply", lambda *a, **kw: "Nice to hear it.")

    user_turn, ai_turn = conversation.submit_user_turn(conn, session, text="Thanks", audio_bytes=None)
    turns = conversation.get_turns(conn, session["id"])
    assert [t["speaker"] for t in turns] == ["ai", "user", "ai"]
    assert [t["turn_index"] for t in turns] == [0, 1, 2]
    assert user_turn["text"] == "Thanks"
    assert ai_turn["text"] == "Nice to hear it."


# --- session creation --------------------------------------------------------

def test_a_failed_opening_leaves_no_empty_session(tmp_path, monkeypatch):
    """The session row used to be committed before the opening was generated,
    so a failure left a conversation with zero turns sitting in the learner's
    history — one that "resume" could only ever reopen empty."""
    conn = _fresh_conn(tmp_path)
    conn.execute(
        "INSERT INTO users (id, display_name, native_language, target_language, created_at) "
        "VALUES ('u1', 'T', 'en', 'en', '2026-01-01T00:00:00Z')"
    )
    conn.execute("INSERT INTO user_settings (user_id) VALUES ('u1')")
    conn.commit()
    from app.services.voice import model_catalog
    from app.services.voice.errors import EngineUnavailable

    monkeypatch.setattr(model_catalog, "llm_is_downloaded", lambda o: True)
    monkeypatch.setattr(conversation, "_ensure_launched", lambda *a, **kw: None)

    def _boom(*a, **kw):
        raise EngineUnavailable("model fell over")

    monkeypatch.setattr(conversation, "_generate_reply", _boom)
    with pytest.raises(EngineUnavailable):
        conversation.start_session(conn, user_id="u1", scenario="coffee", channel="text")

    assert conn.execute("SELECT COUNT(*) AS n FROM conversation_sessions").fetchone()["n"] == 0


def test_a_successful_start_records_the_session_and_its_opening(tmp_path, monkeypatch):
    conn = _fresh_conn(tmp_path)
    session = _session_with_opening(conn, monkeypatch)
    turns = conversation.get_turns(conn, session["id"])
    assert [t["speaker"] for t in turns] == ["ai"]
    assert turns[0]["text"] == "Hello there!"
