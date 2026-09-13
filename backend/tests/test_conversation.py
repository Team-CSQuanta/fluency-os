"""Conversation sessions/turns/reports (spec §6). The three voice engines
(LLM/STT/TTS) are mocked everywhere here via monkeypatch — same precedent as
test_vocabulary_manual_add.py's dictionary_lookup mocking — the real local
models are never loaded in the automated suite.
"""

import json
from pathlib import Path

import pytest

from app.config import settings
from app.db import get_connection
from app.migrations.runner import run_migrations
from app.routers import conversation as conversation_router
from app.services import conversation, conversation_report, vocabulary
from app.services.voice import (
    download_manager,
    engine_status,
    llm_chat_engine,
    model_catalog,
    model_manager,
    stt_engine,
    tts_engine,
)
from app.services.voice.errors import EngineUnavailable


def _fresh_conn(tmp_path, name="conv_test.db"):
    settings.db_path = str(tmp_path / name)
    conn = get_connection()
    run_migrations(conn)
    return conn


def _make_user(conn, user_id="u1"):
    conn.execute(
        "INSERT INTO users (id, display_name, native_language, target_language, created_at) "
        "VALUES (?, 'Test User', 'en', 'en', '2026-01-01T00:00:00Z')",
        (user_id,),
    )
    conn.commit()
    return user_id


def _save_word(conn, user_id, word, definition="a test definition"):
    vocabulary.save_manual_word(
        conn,
        user_id=user_id,
        word=word,
        pos="noun",
        definition=definition,
        example=None,
        synonyms=[],
        ipa=None,
        audio_url=None,
        note_text=None,
    )
    row = conn.execute("SELECT id FROM vocab_words WHERE user_id = ? AND word = ?", (user_id, word)).fetchone()
    return row["id"]


def _target_words_from_prompt(system_prompt: str) -> list[str]:
    """The fake reads the target words out of the prompt, the same place a real
    model reads them from — so it can't be handed data the model wouldn't have."""
    marker = "Target words: "
    if marker not in system_prompt:
        return []
    tail = system_prompt.rsplit(marker, 1)[1].rstrip(".")
    return [] if tail == "(none)" else [w.strip() for w in tail.split(",") if w.strip()]


def fake_analysis(target_words: list[str]) -> dict:
    """Built from LlmReportAnalysis's own fields, so a fake can never quietly
    disagree with the schema the production path parses. Returning a
    hand-written reader-shaped dict is exactly how four permanently-zero report
    fields stayed green in CI — see docs/conversation-report-design.md."""
    payload: dict = {}
    for name in conversation_report.LlmReportAnalysis.model_fields:
        if name == "word_usage":
            payload[name] = {w: "spontaneous" for w in target_words}
        elif name == "errors":
            payload[name] = [{"bad": "bad sentence", "good": "good sentence", "why": "grammar"}]
        elif name == "summary":
            payload[name] = "Solid session."
        elif name == "grammatical_precision":
            payload[name] = 80
        elif name == "self_corrections":
            payload[name] = 1
        else:  # a field was added to the schema without a sentinel here
            raise AssertionError(f"fake_analysis has no value for new field {name!r}")
    return payload


@pytest.fixture()
def fake_llm(monkeypatch):
    calls = {"replies": [], "reports": []}

    def fake_generate_reply(system_prompt, history, *, repo_id, filename, max_tokens=220):
        calls["replies"].append((system_prompt, history))
        return f"AI reply #{len(calls['replies'])}"

    def fake_generate_json(system_prompt, user_prompt, *, repo_id, filename, max_tokens=300, temperature=0.4):
        calls["reports"].append((system_prompt, user_prompt))
        return fake_analysis(_target_words_from_prompt(system_prompt))

    monkeypatch.setattr(conversation.llm_chat_engine, "generate_reply", fake_generate_reply)
    monkeypatch.setattr(conversation.llm_chat_engine, "generate_json", fake_generate_json)
    # These tests exercise chat orchestration, not the "is a model actually
    # downloaded" gate or the "is it actually loaded into memory" gate —
    # those have their own dedicated tests below.
    monkeypatch.setattr(conversation, "_ensure_ready", lambda *a, **kw: None)
    monkeypatch.setattr(conversation, "_ensure_ready_for_target", lambda *a, **kw: None)
    monkeypatch.setattr(conversation, "_ensure_launched", lambda *a, **kw: None)
    return calls


# ---------------------------------------------------------------- service: start_session


def test_start_session_picks_unused_words_and_generates_opening_turn(tmp_path, fake_llm):
    conn = _fresh_conn(tmp_path)
    user_id = _make_user(conn)
    _save_word(conn, user_id, "reticent")
    _save_word(conn, user_id, "stark")

    session_id = conversation.start_session(conn, user_id=user_id, scenario="free", channel="text")
    conn.commit()

    session = conversation.get_session_row(conn, session_id, user_id)
    assert session["scenario"] == "free"
    target_ids = json.loads(session["target_word_ids"])
    assert len(target_ids) == 2

    turns = conversation.get_turns(conn, session_id)
    assert len(turns) == 1
    assert turns[0]["speaker"] == "ai"
    assert turns[0]["text"] == "AI reply #1"


def test_start_session_prefers_words_never_used_in_conversation(tmp_path, fake_llm):
    conn = _fresh_conn(tmp_path)
    user_id = _make_user(conn)
    used_id = _save_word(conn, user_id, "mitigate")
    unused_id = _save_word(conn, user_id, "headway")
    conn.execute(
        "INSERT INTO review_logs (id, user_id, vocab_word_id, session_id, source, outcome, created_at) "
        "VALUES ('rl1', ?, ?, NULL, 'conversation', 'spontaneous', '2026-01-01T00:00:00Z')",
        (user_id, used_id),
    )
    conn.commit()

    session_id = conversation.start_session(conn, user_id=user_id, scenario="free", channel="text")
    session = conversation.get_session_row(conn, session_id, user_id)
    target_ids = json.loads(session["target_word_ids"])
    # both fit within TARGET_WORD_COUNT, but the never-used word sorts first
    assert target_ids[0] == unused_id


def test_avoided_words_are_not_treated_as_practised(tmp_path, fake_llm):
    """'avoided' means the word was offered but never actually said — it still
    needs practice, so it must not sort behind a word the learner really
    used."""
    conn = _fresh_conn(tmp_path)
    user_id = _make_user(conn)
    avoided_id = _save_word(conn, user_id, "mitigate")
    used_id = _save_word(conn, user_id, "headway")
    conn.executemany(
        "INSERT INTO review_logs (id, user_id, vocab_word_id, session_id, source, outcome, created_at) "
        "VALUES (?, ?, ?, NULL, 'conversation', ?, '2026-01-01T00:00:00Z')",
        [
            ("rl1", user_id, avoided_id, "avoided"),
            ("rl2", user_id, used_id, "spontaneous"),
        ],
    )
    conn.commit()

    session_id = conversation.start_session(conn, user_id=user_id, scenario="free", channel="text")
    session = conversation.get_session_row(conn, session_id, user_id)
    assert json.loads(session["target_word_ids"])[0] == avoided_id


def test_start_session_with_no_saved_words_still_works(tmp_path, fake_llm):
    conn = _fresh_conn(tmp_path)
    user_id = _make_user(conn)
    session_id = conversation.start_session(conn, user_id=user_id, scenario="coffee", channel="text")
    session = conversation.get_session_row(conn, session_id, user_id)
    assert json.loads(session["target_word_ids"]) == []


# ---------------------------------------------------------------- service: submit_user_turn


def test_submit_user_turn_text_channel(tmp_path, fake_llm):
    conn = _fresh_conn(tmp_path)
    user_id = _make_user(conn)
    session_id = conversation.start_session(conn, user_id=user_id, scenario="free", channel="text")
    session = conversation.get_session_row(conn, session_id, user_id)

    user_turn, ai_turn = conversation.submit_user_turn(conn, session, text="Hello there", audio_bytes=None)
    assert user_turn["text"] == "Hello there"
    assert user_turn["turn_index"] == 1
    assert ai_turn["turn_index"] == 2
    assert ai_turn["text"] == "AI reply #2"  # #1 was the opening turn


def test_submit_user_turn_on_a_legacy_session_uses_current_preference_not_fixed_default(tmp_path, fake_llm, monkeypatch):
    """A session created with no model_id (e.g. a row from before this was
    tracked) must not silently pin itself to the catalog's fixed default —
    it should pick up whatever the user currently has downloaded/selected."""
    conn = _fresh_conn(tmp_path)
    user_id = _make_user(conn)
    session_id = conversation.start_session(conn, user_id=user_id, scenario="free", channel="text")
    conn.execute("UPDATE conversation_sessions SET model_id = NULL WHERE id = ?", (session_id,))
    conn.commit()
    session = conversation.get_session_row(conn, session_id, user_id)
    assert session["model_id"] is None

    monkeypatch.setattr(model_catalog, "llm_is_downloaded", lambda option: option.key == "qwen2.5-0.5b")

    captured = {}

    def fake_generate_reply(system_prompt, history, *, repo_id, filename, max_tokens=220):
        captured["repo_id"], captured["filename"] = repo_id, filename
        return "reply"

    monkeypatch.setattr(conversation.llm_chat_engine, "generate_reply", fake_generate_reply)

    conversation.submit_user_turn(conn, session, text="hi", audio_bytes=None)
    expected = model_catalog.llm_option("qwen2.5-0.5b")
    assert captured == {"repo_id": expected.repo_id, "filename": expected.filename}


def test_submit_user_turn_voice_channel_transcribes_and_synthesizes(tmp_path, fake_llm, monkeypatch):
    monkeypatch.setattr(conversation.stt_engine, "transcribe", lambda audio_bytes: ("transcribed text", 0.87, 3.5))
    monkeypatch.setattr(conversation.tts_engine, "synthesize", lambda text: b"RIFF-fake-wav-bytes")

    conn = _fresh_conn(tmp_path)
    user_id = _make_user(conn)
    session_id = conversation.start_session(conn, user_id=user_id, scenario="free", channel="voice")
    session = conversation.get_session_row(conn, session_id, user_id)

    user_turn, ai_turn = conversation.submit_user_turn(conn, session, text=None, audio_bytes=b"fake-audio")
    assert user_turn["text"] == "transcribed text"
    assert user_turn["stt_confidence"] == 0.87
    assert user_turn["speech_seconds"] == 3.5
    # Nothing is synthesized during the turn any more — that used to make the
    # learner wait tens of seconds before seeing a reply at all.
    assert ai_turn["audio_path"] is None
    assert conversation.audio_chunk_count(ai_turn, "voice") >= 1
    # The audio is still really available, just made when it's asked for.
    path = conversation.ensure_audio_chunk(ai_turn["id"], ai_turn["text"], 0)
    assert path.exists()


def test_stt_rejects_silent_and_too_short_clips_with_their_own_message(monkeypatch):
    """A muted mic and a mistimed double-tap both used to land on the generic
    "nothing was recognised" message, which points at the wrong fix. The real
    decode path is exercised here with synthesised samples; only the model
    itself is stubbed, since it must never be reached for either case."""
    import numpy as np

    from app.services.voice import stt_engine

    monkeypatch.setattr(stt_engine, "_model", object())
    monkeypatch.setattr(stt_engine, "_load_model_locked", lambda: stt_engine._model)

    silent = np.zeros(16000 * 3, dtype=np.float32)
    too_short = (np.random.rand(int(16000 * 0.2)).astype(np.float32) - 0.5)

    def fake_decode(_buf, sampling_rate):
        return fake_decode.audio

    monkeypatch.setattr("faster_whisper.audio.decode_audio", fake_decode)

    fake_decode.audio = silent
    with pytest.raises(ValueError, match="silent"):
        stt_engine.transcribe(b"ignored")

    fake_decode.audio = too_short
    with pytest.raises(ValueError, match="0.2s"):
        stt_engine.transcribe(b"ignored")


def test_submit_user_turn_raises_clear_error_when_transcript_is_empty(tmp_path, fake_llm, monkeypatch):
    """Silence or a too-short clip can transcribe to "" — sending that on to
    the LLM isn't meaningful for any provider, and some (Gemini) reject it
    outright with a confusing unrelated-looking error. Fail honestly here
    instead of ever calling the LLM with an empty turn."""
    monkeypatch.setattr(conversation.stt_engine, "transcribe", lambda audio_bytes: ("   ", 0.2, 1.0))
    monkeypatch.setattr(conversation.tts_engine, "synthesize", lambda text: b"RIFF-fake-wav-bytes")

    conn = _fresh_conn(tmp_path)
    user_id = _make_user(conn)
    session_id = conversation.start_session(conn, user_id=user_id, scenario="free", channel="voice")
    session = conversation.get_session_row(conn, session_id, user_id)

    with pytest.raises(ValueError, match="Didn't catch"):
        conversation.submit_user_turn(conn, session, text=None, audio_bytes=b"fake-audio")


# ---------------------------------------------------------------- service: end_session


def test_end_session_computes_report_and_writes_review_logs(tmp_path, fake_llm):
    conn = _fresh_conn(tmp_path)
    user_id = _make_user(conn)
    word_id = _save_word(conn, user_id, "reticent")
    session_id = conversation.start_session(conn, user_id=user_id, scenario="free", channel="text")
    session = conversation.get_session_row(conn, session_id, user_id)
    conversation.submit_user_turn(conn, session, text="I was reticent about it.", audio_bytes=None)
    session = conversation.get_session_row(conn, session_id, user_id)

    report = conversation.end_session(conn, session)
    assert report["contextual_accuracy_pct"] == 100
    assert report["grammatical_precision"] == 80
    assert report["turn_count"] == 3
    assert report["routing"][0]["word"] == "reticent"
    assert report["routing"][0]["outcome"] == "spontaneous"
    assert report["errors"][0]["bad"] == "bad sentence"

    logs = conn.execute("SELECT * FROM review_logs WHERE vocab_word_id = ?", (word_id,)).fetchall()
    assert len(logs) == 1
    assert logs[0]["outcome"] == "spontaneous"

    row = conn.execute("SELECT report_json, ended_at FROM conversation_sessions WHERE id = ?", (session_id,)).fetchone()
    assert row["ended_at"] is not None
    assert json.loads(row["report_json"])["session_id"] == session_id


def test_re_ending_a_session_replaces_its_usage_logs_instead_of_appending(tmp_path, fake_llm):
    """Each end recomputes over the whole transcript, so a re-end supersedes
    the previous logs — appending would make one conversation count twice in
    a word's usage history and in target-word selection."""
    conn = _fresh_conn(tmp_path)
    user_id = _make_user(conn)
    word_id = _save_word(conn, user_id, "reticent")
    session_id = conversation.start_session(conn, user_id=user_id, scenario="free", channel="text")
    session = conversation.get_session_row(conn, session_id, user_id)
    conversation.submit_user_turn(conn, session, text="I was reticent about it.", audio_bytes=None)

    session = conversation.get_session_row(conn, session_id, user_id)
    conversation.end_session(conn, session)
    conversation.submit_user_turn(conn, session, text="Still reticent, honestly.", audio_bytes=None)
    session = conversation.get_session_row(conn, session_id, user_id)
    conversation.end_session(conn, session)

    logs = conn.execute("SELECT * FROM review_logs WHERE vocab_word_id = ?", (word_id,)).fetchall()
    assert len(logs) == 1
    assert conversation.word_usage_counts(conn, word_id) == {"spontaneous": 1}


def test_can_continue_a_session_after_it_was_ended(tmp_path, fake_llm):
    """Ending a session is a checkpoint, not a hard close — more turns can
    still be submitted afterward, and re-ending recomputes the report."""
    conn = _fresh_conn(tmp_path)
    user_id = _make_user(conn)
    session_id = conversation.start_session(conn, user_id=user_id, scenario="free", channel="text")
    session = conversation.get_session_row(conn, session_id, user_id)
    conversation.submit_user_turn(conn, session, text="first turn", audio_bytes=None)
    session = conversation.get_session_row(conn, session_id, user_id)
    first_report = conversation.end_session(conn, session)
    assert first_report["turn_count"] == 3

    session = conversation.get_session_row(conn, session_id, user_id)
    assert session["ended_at"] is not None
    # continuing after end must not raise
    conversation.submit_user_turn(conn, session, text="second turn", audio_bytes=None)
    session = conversation.get_session_row(conn, session_id, user_id)
    second_report = conversation.end_session(conn, session)
    assert second_report["turn_count"] == 5


def test_delete_session_removes_row_turns_and_audio_files(tmp_path, fake_llm, monkeypatch):
    monkeypatch.setattr(conversation.tts_engine, "synthesize", lambda text: b"RIFF-fake-wav-bytes")
    conn = _fresh_conn(tmp_path)
    user_id = _make_user(conn)
    session_id = conversation.start_session(conn, user_id=user_id, scenario="free", channel="voice")
    session = conversation.get_session_row(conn, session_id, user_id)
    turn = conn.execute("SELECT id, text FROM conversation_turns WHERE session_id = ?", (session_id,)).fetchone()
    # Per-sentence audio is written lazily and named off the turn id, so it is
    # not reachable through audio_path — deletion has to find it anyway.
    chunk = conversation.ensure_audio_chunk(turn["id"], turn["text"], 0)
    assert chunk.exists()

    assert conversation.delete_session(conn, user_id, session_id) is True

    assert conversation.get_session_row(conn, session_id, user_id) is None
    assert conn.execute("SELECT COUNT(*) AS n FROM conversation_turns WHERE session_id = ?", (session_id,)).fetchone()["n"] == 0
    assert not chunk.exists()


def test_delete_session_returns_false_for_unknown_or_other_users_session(tmp_path, fake_llm):
    conn = _fresh_conn(tmp_path)
    user_id = _make_user(conn)
    other_user_id = _make_user(conn, user_id="u2")
    session_id = conversation.start_session(conn, user_id=user_id, scenario="free", channel="text")

    assert conversation.delete_session(conn, other_user_id, session_id) is False
    assert conversation.delete_session(conn, user_id, "not-a-real-id") is False
    assert conversation.get_session_row(conn, session_id, user_id) is not None


def test_word_usage_counts(tmp_path, fake_llm):
    conn = _fresh_conn(tmp_path)
    user_id = _make_user(conn)
    word_id = _save_word(conn, user_id, "reticent")
    session_id = conversation.start_session(conn, user_id=user_id, scenario="free", channel="text")
    session = conversation.get_session_row(conn, session_id, user_id)
    conversation.submit_user_turn(conn, session, text="reticent", audio_bytes=None)
    session = conversation.get_session_row(conn, session_id, user_id)
    conversation.end_session(conn, session)

    assert conversation.word_usage_counts(conn, word_id) == {"spontaneous": 1}


# ---------------------------------------------------------------- routes


def _create_user(client, auth_headers):
    res = client.post(
        "/users",
        headers=auth_headers,
        json={"display_name": "Reader", "native_language": "en", "target_language": "en", "data_folder": "~/FluencyOS"},
    )
    assert res.status_code == 201
    return res.json()["id"]


def test_conversation_routes_require_token(client):
    res = client.get("/conversation/sessions", params={"user_id": "u1"})
    assert res.status_code == 401


def test_conversation_engine_status_route(client, auth_headers):
    user_id = _create_user(client, auth_headers)
    res = client.get("/conversation/engine-status", headers=auth_headers, params={"user_id": user_id})
    assert res.status_code == 200
    body = res.json()
    assert set(body.keys()) == {"llm", "stt", "tts"}


def test_full_session_lifecycle_via_http(client, auth_headers, monkeypatch):
    monkeypatch.setattr(conversation_router.conversation, "_ensure_ready", lambda *a, **kw: None)
    monkeypatch.setattr(conversation_router.conversation, "_ensure_ready_for_target", lambda *a, **kw: None)
    monkeypatch.setattr(conversation_router.conversation, "_ensure_launched", lambda *a, **kw: None)
    monkeypatch.setattr(
        conversation_router.conversation.llm_chat_engine,
        "generate_reply",
        lambda system_prompt, history, *, repo_id, filename, max_tokens=220: "Hi! How was your week?",
    )
    monkeypatch.setattr(
        conversation_router.conversation.llm_chat_engine,
        "generate_json",
        lambda sp, up, **kw: {**fake_analysis([]), "summary": "Fine."},
    )

    user_id = _create_user(client, auth_headers)

    start = client.post(
        "/conversation/sessions", headers=auth_headers, json={"user_id": user_id, "scenario": "free", "channel": "text"}
    )
    assert start.status_code == 200
    session = start.json()
    assert session["target_words"] == []

    turn = client.post(
        f"/conversation/sessions/{session['id']}/turns",
        headers=auth_headers,
        params={"user_id": user_id},
        data={"text": "Hello!"},
    )
    assert turn.status_code == 200
    body = turn.json()
    assert body["user_turn"]["text"] == "Hello!"
    assert body["ai_turn"]["text"] == "Hi! How was your week?"

    end = client.post(f"/conversation/sessions/{session['id']}/end", headers=auth_headers, params={"user_id": user_id})
    assert end.status_code == 200
    assert end.json()["summary"] == "Fine."

    report = client.get(f"/conversation/sessions/{session['id']}/report", headers=auth_headers, params={"user_id": user_id})
    assert report.status_code == 200
    assert report.json()["summary"] == "Fine."

    detail = client.get(f"/conversation/sessions/{session['id']}", headers=auth_headers, params={"user_id": user_id})
    assert detail.status_code == 200
    assert len(detail.json()["turns"]) == 3
    assert detail.json()["has_report"] is True

    # a session with a report isn't closed — more turns still go through, and
    # re-ending recomputes rather than 400ing or returning the stale report
    turn2 = client.post(
        f"/conversation/sessions/{session['id']}/turns",
        headers=auth_headers,
        params={"user_id": user_id},
        data={"text": "One more thing!"},
    )
    assert turn2.status_code == 200
    end2 = client.post(f"/conversation/sessions/{session['id']}/end", headers=auth_headers, params={"user_id": user_id})
    assert end2.status_code == 200
    assert end2.json()["turn_count"] == 5

    delete_res = client.delete(f"/conversation/sessions/{session['id']}", headers=auth_headers, params={"user_id": user_id})
    assert delete_res.status_code == 204
    gone = client.get(f"/conversation/sessions/{session['id']}", headers=auth_headers, params={"user_id": user_id})
    assert gone.status_code == 404


def test_submit_turn_route_returns_400_when_transcript_is_empty(client, auth_headers, monkeypatch):
    monkeypatch.setattr(conversation_router.conversation, "_ensure_ready", lambda *a, **kw: None)
    monkeypatch.setattr(conversation_router.conversation, "_ensure_ready_for_target", lambda *a, **kw: None)
    monkeypatch.setattr(conversation_router.conversation, "_ensure_launched", lambda *a, **kw: None)
    monkeypatch.setattr(
        conversation_router.conversation.llm_chat_engine,
        "generate_reply",
        lambda system_prompt, history, *, repo_id, filename, max_tokens=220: "Hi!",
    )
    monkeypatch.setattr(conversation_router.conversation.stt_engine, "transcribe", lambda audio_bytes: ("  ", 0.1, 1.0))
    monkeypatch.setattr(conversation_router.conversation.tts_engine, "synthesize", lambda text: b"RIFF-fake-wav-bytes")

    user_id = _create_user(client, auth_headers)
    start = client.post(
        "/conversation/sessions", headers=auth_headers, json={"user_id": user_id, "scenario": "free", "channel": "voice"}
    )
    session_id = start.json()["id"]

    turn = client.post(
        f"/conversation/sessions/{session_id}/turns",
        headers=auth_headers,
        params={"user_id": user_id},
        files={"audio": ("clip.wav", b"fake-audio-bytes", "audio/wav")},
    )
    assert turn.status_code == 400
    assert "Didn't catch" in turn.json()["detail"]


def test_a_report_from_an_older_version_still_opens(client, auth_headers, monkeypatch):
    """Old reports lack every field added since they were written. Defaults
    keep them readable, and report_version lets the UI say "not measured"
    instead of drawing a zero dial for something never computed."""
    monkeypatch.setattr(conversation_router.conversation, "_ensure_ready", lambda *a, **kw: None)
    monkeypatch.setattr(conversation_router.conversation, "_ensure_ready_for_target", lambda *a, **kw: None)
    monkeypatch.setattr(conversation_router.conversation, "_ensure_launched", lambda *a, **kw: None)
    monkeypatch.setattr(
        conversation_router.conversation.llm_chat_engine,
        "generate_reply",
        lambda sp, h, *, repo_id, filename, max_tokens=220: "hi",
    )
    user_id = _create_user(client, auth_headers)
    start = client.post(
        "/conversation/sessions", headers=auth_headers, json={"user_id": user_id, "scenario": "free", "channel": "text"}
    )
    session_id = start.json()["id"]

    # Exactly the v1 shape, as written before any of the new fields existed.
    legacy = {
        "session_id": session_id,
        "contextual_accuracy_pct": 50,
        "fluency_score": 0,
        "vocabulary_reach_score": 0,
        "pronunciation_score": None,
        "words_per_minute": 42,
        "avg_pause_seconds": 3.0,
        "self_corrections": 0,
        "turn_count": 3,
        "routing": [],
        "errors": [],
        "summary": "An older report.",
    }
    conn = get_connection()
    conn.execute(
        "UPDATE conversation_sessions SET report_json = ?, ended_at = '2026-01-01T00:00:00Z' WHERE id = ?",
        (json.dumps(legacy), session_id),
    )
    conn.commit()
    conn.close()

    res = client.get(f"/conversation/sessions/{session_id}/report", headers=auth_headers, params={"user_id": user_id})
    assert res.status_code == 200
    body = res.json()
    assert body["report_version"] == 1
    assert body["summary"] == "An older report."
    # Never measured back then — reported as absent, not as a real zero.
    assert body["grammatical_precision"] is None
    assert body["filler_rate_per_100w"] is None


def test_regenerating_brings_an_old_report_up_to_the_current_shape(client, auth_headers, monkeypatch):
    monkeypatch.setattr(conversation_router.conversation, "_ensure_ready", lambda *a, **kw: None)
    monkeypatch.setattr(conversation_router.conversation, "_ensure_ready_for_target", lambda *a, **kw: None)
    monkeypatch.setattr(conversation_router.conversation, "_ensure_launched", lambda *a, **kw: None)
    monkeypatch.setattr(
        conversation_router.conversation.llm_chat_engine,
        "generate_reply",
        lambda sp, h, *, repo_id, filename, max_tokens=220: "hi",
    )
    monkeypatch.setattr(
        conversation_router.conversation.llm_chat_engine,
        "generate_json",
        lambda sp, up, **kw: fake_analysis(_target_words_from_prompt(sp)),
    )
    user_id = _create_user(client, auth_headers)
    start = client.post(
        "/conversation/sessions", headers=auth_headers, json={"user_id": user_id, "scenario": "free", "channel": "text"}
    )
    session_id = start.json()["id"]

    res = client.post(
        f"/conversation/sessions/{session_id}/report/regenerate", headers=auth_headers, params={"user_id": user_id}
    )
    assert res.status_code == 200
    body = res.json()
    assert body["report_version"] == conversation_report.REPORT_VERSION
    assert body["grammatical_precision"] == 80


def test_every_judged_field_is_actually_populated_in_a_generated_report(tmp_path, fake_llm):
    """The assertion that fails against the original code: the prompt asked for
    three keys, so four of these were permanently zero on every real session."""
    conn = _fresh_conn(tmp_path)
    user_id = _make_user(conn)
    _save_word(conn, user_id, "reticent")
    session_id = conversation.start_session(conn, user_id=user_id, scenario="free", channel="text")
    session = conversation.get_session_row(conn, session_id, user_id)
    conversation.submit_user_turn(conn, session, text="I was reticent about it.", audio_bytes=None)
    session = conversation.get_session_row(conn, session_id, user_id)

    report = conversation.end_session(conn, session)
    assert report["grammatical_precision"] == 80
    assert report["self_corrections"] == 1
    assert report["errors"] != []
    assert report["summary"] != ""
    assert report["routing"][0]["outcome"] == "spontaneous"


def test_practise_again_reuses_the_previous_sessions_target_words(tmp_path, fake_llm):
    conn = _fresh_conn(tmp_path)
    user_id = _make_user(conn)
    keep = _save_word(conn, user_id, "reticent")
    _save_word(conn, user_id, "stark")

    repeated = conversation.start_session(
        conn, user_id=user_id, scenario="free", channel="text", seed_word_ids=[keep]
    )
    session = conversation.get_session_row(conn, repeated, user_id)
    assert json.loads(session["target_word_ids"]) == [keep]


def test_seeding_cannot_pull_in_another_users_word(tmp_path, fake_llm):
    conn = _fresh_conn(tmp_path)
    mine = _make_user(conn, "u1")
    theirs = _make_user(conn, "u2")
    _save_word(conn, mine, "reticent")
    other_word = _save_word(conn, theirs, "clandestine")

    session_id = conversation.start_session(
        conn, user_id=mine, scenario="free", channel="text", seed_word_ids=[other_word]
    )
    session = conversation.get_session_row(conn, session_id, mine)
    assert other_word not in json.loads(session["target_word_ids"])


def test_delete_unknown_session_route_returns_404(client, auth_headers):
    user_id = _create_user(client, auth_headers)
    res = client.delete("/conversation/sessions/not-a-real-id", headers=auth_headers, params={"user_id": user_id})
    assert res.status_code == 404


def test_delete_session_route_requires_token(client):
    res = client.delete("/conversation/sessions/x", params={"user_id": "u1"})
    assert res.status_code == 401


def test_engine_unavailable_maps_to_503(client, auth_headers, monkeypatch):
    def _raise(*a, **kw):
        raise EngineUnavailable("local model isn't loaded")

    monkeypatch.setattr(conversation_router.conversation.llm_chat_engine, "generate_reply", _raise)
    user_id = _create_user(client, auth_headers)
    res = client.post(
        "/conversation/sessions", headers=auth_headers, json={"user_id": user_id, "scenario": "free", "channel": "text"}
    )
    assert res.status_code == 503


def test_vocabulary_detail_surfaces_conversation_usage(client, auth_headers, monkeypatch):
    monkeypatch.setattr(conversation_router.conversation, "_ensure_ready", lambda *a, **kw: None)
    monkeypatch.setattr(conversation_router.conversation, "_ensure_ready_for_target", lambda *a, **kw: None)
    monkeypatch.setattr(conversation_router.conversation, "_ensure_launched", lambda *a, **kw: None)
    monkeypatch.setattr(
        conversation_router.conversation.llm_chat_engine,
        "generate_reply",
        lambda sp, h, *, repo_id, filename, max_tokens=220: "hi",
    )
    monkeypatch.setattr(
        conversation_router.conversation.llm_chat_engine,
        "generate_json",
        lambda sp, up, **kw: fake_analysis(_target_words_from_prompt(sp)),
    )
    user_id = _create_user(client, auth_headers)
    client.post(
        "/vocabulary/manual",
        headers=auth_headers,
        json={"user_id": user_id, "word": "reticent", "pos": "adj", "definition": "reluctant"},
    )
    start = client.post(
        "/conversation/sessions", headers=auth_headers, json={"user_id": user_id, "scenario": "free", "channel": "text"}
    )
    session_id = start.json()["id"]
    client.post(f"/conversation/sessions/{session_id}/end", headers=auth_headers, params={"user_id": user_id})

    detail = client.get("/vocabulary/by-word/reticent", headers=auth_headers, params={"user_id": user_id})
    assert detail.status_code == 200
    assert detail.json()["conversation_usage"] == {"spontaneous": 1}


# ---------------------------------------------------------------- model download gating


def test_start_session_blocked_when_no_model_is_downloaded(tmp_path):
    conn = _fresh_conn(tmp_path)
    user_id = _make_user(conn)
    with pytest.raises(EngineUnavailable):
        conversation.start_session(conn, user_id=user_id, scenario="free", channel="text")
    assert conn.execute("SELECT COUNT(*) AS n FROM conversation_sessions").fetchone()["n"] == 0


def test_selected_llm_option_falls_back_to_whatever_is_downloaded(tmp_path, monkeypatch):
    """No explicit Settings selection yet, but the user did download a
    non-default option — that one should be used, not the (undownloaded)
    catalog default, so 'just download something' is enough to unblock
    Conversation without a separate 'now select it' step."""
    conn = _fresh_conn(tmp_path)
    user_id = _make_user(conn)

    downloaded_key = "qwen2.5-0.5b"
    monkeypatch.setattr(model_catalog, "llm_is_downloaded", lambda option: option.key == downloaded_key)

    option = conversation.selected_llm_option(conn, user_id)
    assert option.key == downloaded_key


def test_selected_llm_option_prefers_explicit_selection_over_downloaded_fallback(tmp_path, monkeypatch):
    conn = _fresh_conn(tmp_path)
    user_id = _make_user(conn)
    conn.execute(
        "INSERT INTO user_settings (user_id, llm_model_id) VALUES (?, 'qwen2.5-3b')", (user_id,)
    )
    # even though a different model is the only one downloaded, the explicit choice wins
    monkeypatch.setattr(model_catalog, "llm_is_downloaded", lambda option: option.key == "qwen2.5-0.5b")

    option = conversation.selected_llm_option(conn, user_id)
    assert option.key == "qwen2.5-3b"


def test_readiness_reports_missing_pieces(tmp_path, monkeypatch):
    conn = _fresh_conn(tmp_path)
    user_id = _make_user(conn)
    monkeypatch.setattr(model_catalog, "llm_is_downloaded", lambda option: option.key == "qwen2.5-1.5b")
    monkeypatch.setattr(model_catalog, "stt_is_downloaded", lambda: False)
    monkeypatch.setattr(model_catalog, "tts_is_downloaded", lambda: True)

    r = conversation.readiness(conn, user_id, "voice")
    assert r == {"ready": False, "llm": True, "stt": False, "tts": True, "llm_model_label": "Qwen2.5 1.5B"}

    # text channel doesn't need STT/TTS at all
    r_text = conversation.readiness(conn, user_id, "text")
    assert r_text["ready"] is True


def test_route_post_sessions_blocked_without_a_downloaded_model(client, auth_headers):
    user_id = _create_user(client, auth_headers)
    res = client.post(
        "/conversation/sessions", headers=auth_headers, json={"user_id": user_id, "scenario": "free", "channel": "text"}
    )
    assert res.status_code == 503
    assert "download it in Settings" in res.json()["detail"]


# ---------------------------------------------------------------- explicit "Launch AI" gating


def test_start_session_blocked_when_downloaded_but_not_launched(tmp_path, monkeypatch):
    """Downloaded is necessary but not sufficient — start_session must also
    refuse to run until the model is actually loaded into memory via the
    explicit Launch AI action, rather than silently lazy-loading it."""
    conn = _fresh_conn(tmp_path)
    user_id = _make_user(conn)
    monkeypatch.setattr(model_catalog, "llm_is_downloaded", lambda option: True)
    monkeypatch.setattr(
        engine_status, "status", lambda *a, **kw: {"llm": "not_loaded", "stt": "not_loaded", "tts": "not_loaded"}
    )
    with pytest.raises(EngineUnavailable, match="Launch AI"):
        conversation.start_session(conn, user_id=user_id, scenario="free", channel="text")
    assert conn.execute("SELECT COUNT(*) AS n FROM conversation_sessions").fetchone()["n"] == 0


def test_submit_user_turn_blocked_when_not_launched(tmp_path, monkeypatch):
    conn = _fresh_conn(tmp_path)
    user_id = _make_user(conn)
    monkeypatch.setattr(model_catalog, "llm_is_downloaded", lambda option: True)
    monkeypatch.setattr(conversation.llm_chat_engine, "generate_reply", lambda *a, **kw: "hi")
    monkeypatch.setattr(engine_status, "status", lambda *a, **kw: {"llm": "ready", "stt": "ready", "tts": "ready"})
    session_id = conversation.start_session(conn, user_id=user_id, scenario="free", channel="text")
    session = conversation.get_session_row(conn, session_id, user_id)

    # Simulate the model no longer being loaded (e.g. it was never actually
    # launched for this request) and confirm submit_user_turn refuses too,
    # not just start_session.
    monkeypatch.setattr(engine_status, "status", lambda *a, **kw: {"llm": "not_loaded", "stt": "ready", "tts": "ready"})
    with pytest.raises(EngineUnavailable, match="Launch AI"):
        conversation.submit_user_turn(conn, session, text="hello", audio_bytes=None)


def test_end_session_blocked_when_not_launched(tmp_path, monkeypatch):
    conn = _fresh_conn(tmp_path)
    user_id = _make_user(conn)
    monkeypatch.setattr(model_catalog, "llm_is_downloaded", lambda option: True)
    monkeypatch.setattr(conversation.llm_chat_engine, "generate_reply", lambda *a, **kw: "hi")
    monkeypatch.setattr(engine_status, "status", lambda *a, **kw: {"llm": "ready", "stt": "ready", "tts": "ready"})
    session_id = conversation.start_session(conn, user_id=user_id, scenario="free", channel="text")
    session = conversation.get_session_row(conn, session_id, user_id)

    monkeypatch.setattr(engine_status, "status", lambda *a, **kw: {"llm": "not_loaded", "stt": "ready", "tts": "ready"})
    with pytest.raises(EngineUnavailable, match="Launch AI"):
        conversation.end_session(conn, session)


def test_launch_engines_warms_up_only_whats_downloaded(tmp_path, monkeypatch):
    conn = _fresh_conn(tmp_path)
    user_id = _make_user(conn)
    monkeypatch.setattr(model_catalog, "llm_is_downloaded", lambda option: True)
    monkeypatch.setattr(model_catalog, "stt_is_downloaded", lambda: False)
    monkeypatch.setattr(model_catalog, "tts_is_downloaded", lambda: True)
    warmed = []
    monkeypatch.setattr(
        conversation.llm_chat_engine, "warm_up", lambda repo_id, filename: warmed.append("llm")
    )
    monkeypatch.setattr(conversation.stt_engine, "warm_up", lambda: warmed.append("stt"))
    monkeypatch.setattr(conversation.tts_engine, "warm_up", lambda: warmed.append("tts"))
    monkeypatch.setattr(
        engine_status, "status", lambda *a, **kw: {"llm": "ready", "stt": "not_loaded", "tts": "ready"}
    )

    result = conversation.launch_engines(conn, user_id)
    assert warmed == ["llm", "tts"]
    assert result == {"llm": "ready", "stt": "not_loaded", "tts": "ready"}


def test_launch_engines_requires_llm_downloaded(tmp_path, monkeypatch):
    conn = _fresh_conn(tmp_path)
    user_id = _make_user(conn)
    monkeypatch.setattr(model_catalog, "llm_is_downloaded", lambda option: False)
    with pytest.raises(EngineUnavailable):
        conversation.launch_engines(conn, user_id)


def test_switching_selected_model_is_treated_as_not_launched_even_if_a_different_model_is_loaded(
    tmp_path, monkeypatch
):
    """The real bug this whole llm_option-pinning change guards against:
    switching the selected model in Settings while a *different* model is
    still resident in memory must not read as "AI is launched" — otherwise
    the next turn would silently pay a reload cost mid-conversation instead
    of being refused with a clear "use Launch AI" message up front."""
    conn = _fresh_conn(tmp_path)
    user_id = _make_user(conn)
    old_option = model_catalog.llm_option("qwen2.5-0.5b")
    new_option = model_catalog.llm_option("qwen2.5-1.5b")

    # Simulate the OLD model already resident in memory (e.g. from an
    # earlier Launch AI), while the NEW one is now selected and downloaded
    # but has never actually been loaded.
    monkeypatch.setattr(llm_chat_engine, "_llm", object())
    monkeypatch.setattr(
        llm_chat_engine, "_loaded_path", str(model_manager.llm_model_path(old_option.repo_id, old_option.filename))
    )
    monkeypatch.setattr(model_catalog, "llm_is_downloaded", lambda option: True)
    conn.execute("INSERT INTO user_settings (user_id, llm_model_id) VALUES (?, 'qwen2.5-1.5b')", (user_id,))
    conn.commit()

    with pytest.raises(EngineUnavailable, match="Launch AI"):
        conversation.start_session(conn, user_id=user_id, scenario="free", channel="text")

    # Switching back to the model that's actually loaded is correctly
    # recognized as launched — this isn't a blanket "always refuse" bug.
    conn.execute("UPDATE user_settings SET llm_model_id = 'qwen2.5-0.5b' WHERE user_id = ?", (user_id,))
    conn.commit()
    monkeypatch.setattr(conversation.llm_chat_engine, "generate_reply", lambda *a, **kw: "hi")
    session_id = conversation.start_session(conn, user_id=user_id, scenario="free", channel="text")
    assert session_id
    assert new_option.key != old_option.key


def test_engine_status_route_requires_token(client):
    res = client.get("/engine/status")
    assert res.status_code == 401


def test_engine_status_route_reflects_engine_status(client, auth_headers, monkeypatch):
    user_id = _create_user(client, auth_headers)
    monkeypatch.setattr(
        engine_status, "status", lambda *a, **kw: {"llm": "ready", "stt": "not_loaded", "tts": "not_loaded"}
    )
    res = client.get("/engine/status", headers=auth_headers, params={"user_id": user_id})
    assert res.status_code == 200
    assert res.json() == {"llm": "ready", "stt": "not_loaded", "tts": "not_loaded"}


def test_engine_launch_route_requires_token(client):
    res = client.post("/engine/launch", params={"user_id": "u1"})
    assert res.status_code == 401


def test_engine_launch_route_triggers_launch_and_returns_status(client, auth_headers, monkeypatch):
    user_id = _create_user(client, auth_headers)
    called = {}

    def fake_launch_engines(conn, uid):
        called["uid"] = uid
        return {"llm": "ready", "stt": "ready", "tts": "ready"}

    monkeypatch.setattr(conversation, "launch_engines", fake_launch_engines)
    res = client.post("/engine/launch", headers=auth_headers, params={"user_id": user_id})
    assert res.status_code == 200
    assert res.json() == {"llm": "ready", "stt": "ready", "tts": "ready"}
    assert called["uid"] == user_id


def test_engine_launch_route_returns_503_when_nothing_downloaded(client, auth_headers):
    user_id = _create_user(client, auth_headers)
    res = client.post("/engine/launch", headers=auth_headers, params={"user_id": user_id})
    assert res.status_code == 503
    assert "download" in res.json()["detail"].lower()


# ---------------------------------------------------------------- delete a downloaded model


def test_delete_llm_route_requires_token(client):
    res = client.delete("/engine/models/llm/qwen2.5-0.5b")
    assert res.status_code == 401


def test_delete_llm_route_removes_file_and_unloads_if_currently_loaded(client, auth_headers):
    option = model_catalog.llm_option("qwen2.5-0.5b")
    path = model_catalog.llm_dest_path(option)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"fake gguf bytes")
    assert path.exists()

    # Simulate this exact model already loaded in memory (as if launched).
    llm_chat_engine._llm = object()
    llm_chat_engine._loaded_path = str(path)
    try:
        res = client.delete(f"/engine/models/llm/{option.key}", headers=auth_headers)
        assert res.status_code == 204
        assert not path.exists()
        assert llm_chat_engine.is_ready() is False
    finally:
        llm_chat_engine._llm = None
        llm_chat_engine._loaded_path = None


def test_delete_llm_route_does_not_unload_a_different_model(client, auth_headers):
    deleted_option = model_catalog.llm_option("qwen2.5-0.5b")
    other_option = model_catalog.llm_option("qwen2.5-1.5b")
    path = model_catalog.llm_dest_path(deleted_option)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"fake gguf bytes")

    other_path = str(model_catalog.llm_dest_path(other_option))
    llm_chat_engine._llm = object()
    llm_chat_engine._loaded_path = other_path
    try:
        res = client.delete(f"/engine/models/llm/{deleted_option.key}", headers=auth_headers)
        assert res.status_code == 204
        assert llm_chat_engine.is_ready() is True
        assert llm_chat_engine.loaded_path() == other_path
    finally:
        llm_chat_engine._llm = None
        llm_chat_engine._loaded_path = None


def test_delete_llm_route_404_when_not_downloaded(client, auth_headers):
    res = client.delete("/engine/models/llm/qwen2.5-3b", headers=auth_headers)
    assert res.status_code == 404


def test_delete_llm_route_409_when_downloading(client, auth_headers, monkeypatch):
    monkeypatch.setattr(
        download_manager,
        "status",
        lambda key: {"status": "downloading", "downloaded_bytes": 10, "total_bytes": 100, "error": None},
    )
    res = client.delete("/engine/models/llm/qwen2.5-0.5b", headers=auth_headers)
    assert res.status_code == 409


def test_delete_stt_route_removes_cache_and_unloads(client, auth_headers):
    cache_dir = model_manager.whisper_cache_dir() / "models--Systran--faster-whisper-tiny.en" / "snapshots" / "x"
    cache_dir.mkdir(parents=True, exist_ok=True)
    (cache_dir / "model.bin").write_bytes(b"fake")
    assert model_catalog.stt_is_downloaded() is True

    stt_engine._model = object()
    try:
        res = client.delete("/engine/models/stt", headers=auth_headers)
        assert res.status_code == 204
        assert model_catalog.stt_is_downloaded() is False
        assert stt_engine.is_ready() is False
    finally:
        stt_engine._model = None


def test_delete_stt_route_404_when_not_downloaded(client, auth_headers):
    res = client.delete("/engine/models/stt", headers=auth_headers)
    assert res.status_code == 404


def test_delete_tts_route_removes_files_and_unloads(client, auth_headers):
    model_path, voices_path = model_manager.tts_voice_paths()
    model_path.parent.mkdir(parents=True, exist_ok=True)
    model_path.write_bytes(b"fake onnx")
    voices_path.write_bytes(b"fake voices")
    assert model_catalog.tts_is_downloaded() is True

    tts_engine._kokoro = object()
    try:
        res = client.delete("/engine/models/tts", headers=auth_headers)
        assert res.status_code == 204
        assert model_catalog.tts_is_downloaded() is False
        assert tts_engine.is_ready() is False
    finally:
        tts_engine._kokoro = None


def test_delete_tts_route_404_when_not_downloaded(client, auth_headers):
    res = client.delete("/engine/models/tts", headers=auth_headers)
    assert res.status_code == 404


# ---------------------------------------------------------------- /engine router


def test_engine_models_route_requires_token(client):
    res = client.get("/engine/models", params={"user_id": "u1"})
    assert res.status_code == 401


def test_engine_models_lists_catalog_with_default_selected(client, auth_headers):
    user_id = _create_user(client, auth_headers)
    res = client.get("/engine/models", headers=auth_headers, params={"user_id": user_id})
    assert res.status_code == 200
    body = res.json()
    # Asserted against the catalog rather than a hardcoded list, so adding an
    # option is a one-line change instead of a test failure.
    assert [o["key"] for o in body["llm"]] == [o.key for o in model_catalog.LLM_OPTIONS]
    selected = [o["key"] for o in body["llm"] if o["selected"]]
    assert selected == [model_catalog.DEFAULT_LLM_KEY]
    assert all(o["downloaded"] is False for o in body["llm"])
    assert body["stt"]["downloaded"] is False
    assert body["tts"]["downloaded"] is False


def test_engine_models_reports_real_models_dir_and_disk_usage(client, auth_headers, tmp_path):
    user_id = _create_user(client, auth_headers)
    res = client.get("/engine/models", headers=auth_headers, params={"user_id": user_id})
    body = res.json()
    # Real path derived from this test's own db_path (see model_manager.models_dir),
    # not a hardcoded/mock string — and nothing's been downloaded, so 0 bytes.
    assert body["models_dir"] == str((tmp_path / "models").resolve())
    assert body["disk_usage_bytes"] == 0

    (tmp_path / "models").mkdir(exist_ok=True)
    (tmp_path / "models" / "fake.gguf").write_bytes(b"x" * 1234)
    res2 = client.get("/engine/models", headers=auth_headers, params={"user_id": user_id})
    assert res2.json()["disk_usage_bytes"] == 1234


def test_engine_select_model_persists_and_reflects_in_list(client, auth_headers):
    user_id = _create_user(client, auth_headers)
    res = client.post("/engine/models/select", headers=auth_headers, json={"user_id": user_id, "model_key": "qwen2.5-0.5b"})
    assert res.status_code == 204

    listed = client.get("/engine/models", headers=auth_headers, params={"user_id": user_id}).json()
    assert [o["key"] for o in listed["llm"] if o["selected"]] == ["qwen2.5-0.5b"]


def _resident_path(key: str) -> str:
    option = model_catalog.llm_option(key)
    return str(model_manager.llm_model_path(option.repo_id, option.filename))


def test_switching_model_evicts_the_previous_one_from_memory(client, auth_headers, monkeypatch):
    """Its RAM is exactly what the incoming model needs, so it has to go now
    rather than whenever the next load happens to run."""
    user_id = _create_user(client, auth_headers)
    monkeypatch.setattr(llm_chat_engine, "loaded_path", lambda: _resident_path("qwen2.5-1.5b"))
    unloaded = []
    monkeypatch.setattr(llm_chat_engine, "unload", lambda *a, **kw: unloaded.append(True))

    res = client.post(
        "/engine/models/select", headers=auth_headers, json={"user_id": user_id, "model_key": "qwen2.5-0.5b"}
    )
    assert res.status_code == 204
    assert unloaded == [True]


def test_reselecting_the_already_loaded_model_keeps_it_resident(client, auth_headers, monkeypatch):
    user_id = _create_user(client, auth_headers)
    monkeypatch.setattr(llm_chat_engine, "loaded_path", lambda: _resident_path("qwen2.5-0.5b"))
    unloaded = []
    monkeypatch.setattr(llm_chat_engine, "unload", lambda *a, **kw: unloaded.append(True))

    client.post(
        "/engine/models/select", headers=auth_headers, json={"user_id": user_id, "model_key": "qwen2.5-0.5b"}
    )
    assert unloaded == []


def test_switching_to_a_cloud_provider_frees_the_local_model(client, auth_headers, monkeypatch):
    user_id = _create_user(client, auth_headers)
    unloaded = []
    monkeypatch.setattr(llm_chat_engine, "unload", lambda *a, **kw: unloaded.append(True))

    client.post(
        "/engine/llm-provider",
        headers=auth_headers,
        json={"user_id": user_id, "provider": "gemini", "gemini_api_key": "gm-x"},
    )
    assert unloaded == [True]


def test_engine_download_route_triggers_background_download(client, auth_headers, monkeypatch):
    started = {}
    monkeypatch.setattr(download_manager, "start_download", lambda kind, key: started.setdefault(kind, key))

    res = client.post("/engine/models/llm/qwen2.5-0.5b/download", headers=auth_headers)
    assert res.status_code == 200
    assert res.json()["status"] == "idle"  # no real download ran (mocked), so state is untouched
    assert started == {"llm": "qwen2.5-0.5b"}


def test_engine_download_status_reflects_progress(client, auth_headers, monkeypatch):
    monkeypatch.setattr(
        download_manager,
        "status",
        lambda key: {"status": "downloading", "downloaded_bytes": 512, "total_bytes": 1024, "error": None},
    )
    user_id = _create_user(client, auth_headers)
    res = client.get("/engine/models", headers=auth_headers, params={"user_id": user_id})
    body = res.json()
    assert body["llm"][0]["download"] == {
        "status": "downloading",
        "downloaded_bytes": 512,
        "total_bytes": 1024,
        "error": None,
    }


def test_engine_readiness_route(client, auth_headers, monkeypatch):
    monkeypatch.setattr(model_catalog, "llm_is_downloaded", lambda option: True)
    monkeypatch.setattr(model_catalog, "stt_is_downloaded", lambda: True)
    monkeypatch.setattr(model_catalog, "tts_is_downloaded", lambda: True)
    user_id = _create_user(client, auth_headers)
    res = client.get("/engine/readiness", headers=auth_headers, params={"user_id": user_id, "channel": "voice"})
    assert res.status_code == 200
    assert res.json()["ready"] is True
