"""The Gemini cloud LLM option, alongside OpenRouter (test_cloud_llm.py) and
local llama.cpp. gemini_llm_engine's network call (urllib) is mocked
everywhere here, same precedent as the rest of this app's engine mocking.
"""

import io
import json
import urllib.error

import pytest

from app.services import conversation
from app.services.voice import gemini_llm_engine
from app.services.voice.errors import EngineUnavailable


class _FakeResponse:
    def __init__(self, body: dict):
        self._body = json.dumps(body).encode("utf-8")

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def _gemini_body(text: str) -> dict:
    return {"candidates": [{"content": {"parts": [{"text": text}]}}]}


# ---------------------------------------------------------------- gemini_llm_engine unit tests


def test_generate_reply_sends_expected_request_and_parses_reply(monkeypatch):
    captured = {}

    def fake_urlopen(request, timeout=60):
        captured["url"] = request.full_url
        captured["headers"] = {k.lower(): v for k, v in request.headers.items()}
        captured["body"] = json.loads(request.data.decode("utf-8"))
        return _FakeResponse(_gemini_body("  Hello there!  "))

    monkeypatch.setattr(gemini_llm_engine.urllib.request, "urlopen", fake_urlopen)

    reply = gemini_llm_engine.generate_reply(
        "system prompt", [("user", "hi"), ("assistant", "hey")], api_key="gm-abc", model="gemini-2.0-flash"
    )
    assert reply == "Hello there!"
    assert captured["url"] == "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent"
    assert captured["headers"]["x-goog-api-key"] == "gm-abc"
    assert captured["body"]["system_instruction"] == {"parts": [{"text": "system prompt"}]}
    # 'assistant' history entries map to Gemini's "model" role.
    assert captured["body"]["contents"] == [
        {"role": "user", "parts": [{"text": "hi"}]},
        {"role": "model", "parts": [{"text": "hey"}]},
    ]


def test_thinking_models_get_budget_headroom_beyond_the_callers_answer_size(monkeypatch):
    """Reasoning tokens are charged against maxOutputTokens before any visible
    text, so sending the caller's answer budget verbatim gets it spent on
    thinking and the reply comes back chopped mid-sentence."""
    captured = {}

    def fake_urlopen(request, timeout=60):
        captured["body"] = json.loads(request.data.decode("utf-8"))
        return _FakeResponse(_gemini_body("Hi!"))

    monkeypatch.setattr(gemini_llm_engine.urllib.request, "urlopen", fake_urlopen)
    gemini_llm_engine.generate_reply("sp", [], api_key="k", model="m", max_tokens=220)
    assert captured["body"]["generationConfig"]["maxOutputTokens"] > 220


def test_reply_cut_off_by_the_token_ceiling_is_refused_not_stored(monkeypatch):
    """A half-sentence would otherwise be persisted as a real turn and every
    later turn built on top of it."""

    def fake_urlopen(request, timeout=60):
        return _FakeResponse(
            {"candidates": [{"content": {"parts": [{"text": "Yes, I can hear you loud and"}]}, "finishReason": "MAX_TOKENS"}]}
        )

    monkeypatch.setattr(gemini_llm_engine.urllib.request, "urlopen", fake_urlopen)
    with pytest.raises(EngineUnavailable, match="output budget"):
        gemini_llm_engine.generate_reply("sp", [], api_key="k", model="gemini-3.6-flash")


def test_reasoning_parts_are_never_returned_as_the_reply(monkeypatch):
    def fake_urlopen(request, timeout=60):
        return _FakeResponse(
            {
                "candidates": [
                    {
                        "content": {
                            "parts": [
                                {"text": "The user greeted me, so I should...", "thought": True},
                                {"text": "Hey, good to see you!"},
                            ]
                        },
                        "finishReason": "STOP",
                    }
                ]
            }
        )

    monkeypatch.setattr(gemini_llm_engine.urllib.request, "urlopen", fake_urlopen)
    assert gemini_llm_engine.generate_reply("sp", [], api_key="k", model="m") == "Hey, good to see you!"


def test_generate_reply_without_api_key_raises_clear_message():
    with pytest.raises(EngineUnavailable, match="Gemini API key"):
        gemini_llm_engine.generate_reply("sp", [], api_key=None, model="gemini-2.0-flash")


def test_generate_reply_surfaces_http_error(monkeypatch):
    def fake_urlopen(request, timeout=60):
        raise urllib.error.HTTPError(
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent",
            429,
            "Too Many Requests",
            {},
            io.BytesIO(b"rate limited"),
        )

    monkeypatch.setattr(gemini_llm_engine.urllib.request, "urlopen", fake_urlopen)
    with pytest.raises(EngineUnavailable, match="429"):
        gemini_llm_engine.generate_reply("sp", [], api_key="bad-key", model="gemini-2.0-flash")


def test_generate_json_requests_json_mime_type_and_parses_object(monkeypatch):
    captured = {}

    def fake_urlopen(request, timeout=60):
        captured["body"] = json.loads(request.data.decode("utf-8"))
        return _FakeResponse(_gemini_body('{"mnemonic": "sounds like X"}'))

    monkeypatch.setattr(gemini_llm_engine.urllib.request, "urlopen", fake_urlopen)
    result = gemini_llm_engine.generate_json("sp", "up", api_key="k", model="m")
    assert result == {"mnemonic": "sounds like X"}
    assert captured["body"]["generationConfig"]["responseMimeType"] == "application/json"


def test_generate_json_raises_when_not_valid_json(monkeypatch):
    def fake_urlopen(request, timeout=60):
        return _FakeResponse(_gemini_body("not json at all"))

    monkeypatch.setattr(gemini_llm_engine.urllib.request, "urlopen", fake_urlopen)
    with pytest.raises(EngineUnavailable, match="valid JSON"):
        gemini_llm_engine.generate_json("sp", "up", api_key="k", model="m")


# ---------------------------------------------------------------- conversation.py provider dispatch


def _fresh_conn(tmp_path, name="gemini_test.db"):
    from app.config import settings
    from app.db import get_connection
    from app.migrations.runner import run_migrations

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


def _set_gemini_provider(conn, user_id, *, api_key="gm-testkey1234", model="gemini-2.0-flash"):
    conn.execute(
        "INSERT INTO user_settings (user_id, llm_mode, api_provider, gemini_api_key, gemini_model) "
        "VALUES (?, 'api', 'gemini', ?, ?) "
        "ON CONFLICT(user_id) DO UPDATE SET llm_mode='api', api_provider='gemini', "
        "gemini_api_key=excluded.gemini_api_key, gemini_model=excluded.gemini_model",
        (user_id, api_key, model),
    )
    conn.commit()


def test_llm_target_resolves_gemini_when_api_provider_is_gemini(tmp_path):
    conn = _fresh_conn(tmp_path)
    user_id = _make_user(conn)
    _set_gemini_provider(conn, user_id, api_key="gm-xyz", model="gemini-2.0-flash")

    target = conversation.llm_target(conn, user_id)
    assert target == {"provider": "gemini", "model": "gemini-2.0-flash", "api_key": "gm-xyz"}


def test_readiness_gemini_ready_iff_api_key_present(tmp_path):
    conn = _fresh_conn(tmp_path)
    user_id = _make_user(conn)
    _set_gemini_provider(conn, user_id, api_key="")
    r = conversation.readiness(conn, user_id, "text")
    assert r["llm"] is False

    _set_gemini_provider(conn, user_id, api_key="gm-real")
    r2 = conversation.readiness(conn, user_id, "text")
    assert r2["llm"] is True
    assert "Gemini" in r2["llm_model_label"]


def test_start_session_uses_gemini_engine_and_freezes_model_id(tmp_path, monkeypatch):
    conn = _fresh_conn(tmp_path)
    user_id = _make_user(conn)
    _set_gemini_provider(conn, user_id, api_key="gm-real", model="gemini-2.0-flash")

    captured = {}

    def fake_generate_reply(system_prompt, history, *, api_key, model, max_tokens=220):
        captured["api_key"], captured["model"] = api_key, model
        return "Hi! Welcome."

    monkeypatch.setattr(gemini_llm_engine, "generate_reply", fake_generate_reply)

    session_id = conversation.start_session(conn, user_id=user_id, scenario="free", channel="text")
    session = conversation.get_session_row(conn, session_id, user_id)
    assert session["model_id"] == "cloud:gemini:gemini-2.0-flash"
    assert captured == {"api_key": "gm-real", "model": "gemini-2.0-flash"}


def test_switching_provider_rescues_a_session_whose_engine_stopped_working(tmp_path, monkeypatch):
    """The case this behaviour exists for: Gemini's quota runs out mid-chat, so
    the learner switches to a local model and carries on in the same
    conversation instead of losing it."""
    conn = _fresh_conn(tmp_path)
    user_id = _make_user(conn)
    _set_gemini_provider(conn, user_id, api_key="gm-real", model="gemini-2.0-flash")
    monkeypatch.setattr(gemini_llm_engine, "generate_reply", lambda *a, **kw: "opening")
    session_id = conversation.start_session(conn, user_id=user_id, scenario="free", channel="text")
    session = conversation.get_session_row(conn, session_id, user_id)

    conn.execute(
        "UPDATE user_settings SET llm_mode = 'local', llm_model_id = 'qwen2.5-0.5b' WHERE user_id = ?", (user_id,)
    )
    conn.commit()

    monkeypatch.setattr(conversation, "_ensure_ready_for_target", lambda *a, **kw: None)
    monkeypatch.setattr(conversation, "_ensure_launched", lambda *a, **kw: None)
    monkeypatch.setattr(
        conversation.llm_chat_engine,
        "generate_reply",
        lambda system_prompt, history, *, repo_id, filename, max_tokens=220: "carried on locally",
    )
    _user_turn, ai_turn = conversation.submit_user_turn(conn, session, text="hello", audio_bytes=None)
    assert ai_turn["text"] == "carried on locally"


def test_session_engine_names_what_will_actually_answer(tmp_path, monkeypatch):
    """The UI reads the engine from here rather than from global state, which
    is how it ended up naming the local model while turns went to Gemini."""
    conn = _fresh_conn(tmp_path)
    user_id = _make_user(conn)
    _set_gemini_provider(conn, user_id, api_key="gm-real", model="gemini-2.0-flash")
    monkeypatch.setattr(gemini_llm_engine, "generate_reply", lambda *a, **kw: "opening")
    session_id = conversation.start_session(conn, user_id=user_id, scenario="free", channel="text")
    session = conversation.get_session_row(conn, session_id, user_id)

    engine = conversation.session_engine(conn, session)
    assert engine["provider"] == "gemini"
    assert "gemini-2.0-flash" in engine["label"]

    conn.execute(
        "UPDATE user_settings SET llm_mode = 'local', llm_model_id = 'qwen2.5-0.5b' WHERE user_id = ?", (user_id,)
    )
    conn.commit()
    switched = conversation.session_engine(conn, session)
    assert switched["provider"] == "local"
    assert "Qwen2.5 0.5B" in switched["label"]
