"""The cloud LLM option (OpenRouter), switchable per-user against the local
llama.cpp path. cloud_llm_engine's actual network call (urllib) is mocked
everywhere here — no real request ever leaves the test suite, same
precedent as the rest of this app's engine mocking.
"""

import io
import json
import urllib.error

import pytest

from app.services import conversation
from app.services.voice import cloud_llm_engine, engine_status, model_catalog
from app.services.voice.errors import EngineUnavailable


def _create_user(client, auth_headers):
    res = client.post(
        "/users",
        headers=auth_headers,
        json={
            "display_name": "Reader",
            "native_language": "en",
            "target_language": "en",
            "data_folder": "~/FluencyOS",
        },
    )
    assert res.status_code == 201
    return res.json()["id"]


def _set_cloud_provider(conn, user_id, *, api_key="sk-or-v1-testkey1234", model="openai/gpt-4o-mini"):
    conn.execute(
        "INSERT INTO user_settings (user_id, llm_mode, api_provider, openrouter_api_key, openrouter_model) "
        "VALUES (?, 'api', 'openrouter', ?, ?) "
        "ON CONFLICT(user_id) DO UPDATE SET llm_mode='api', api_provider='openrouter', "
        "openrouter_api_key=excluded.openrouter_api_key, openrouter_model=excluded.openrouter_model",
        (user_id, api_key, model),
    )
    conn.commit()


class _FakeResponse:
    def __init__(self, body: dict):
        self._body = json.dumps(body).encode("utf-8")

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


# ---------------------------------------------------------------- cloud_llm_engine unit tests


def test_generate_reply_sends_expected_request_and_parses_reply(monkeypatch):
    captured = {}

    def fake_urlopen(request, timeout=60):
        captured["url"] = request.full_url
        captured["headers"] = {k.lower(): v for k, v in request.headers.items()}
        captured["body"] = json.loads(request.data.decode("utf-8"))
        return _FakeResponse({"choices": [{"message": {"content": "  Hello there!  "}}]})

    monkeypatch.setattr(cloud_llm_engine.urllib.request, "urlopen", fake_urlopen)

    reply = cloud_llm_engine.generate_reply(
        "system prompt", [("user", "hi")], api_key="sk-or-v1-abc", model="openai/gpt-4o-mini"
    )
    assert reply == "Hello there!"
    assert captured["url"] == "https://openrouter.ai/api/v1/chat/completions"
    assert captured["headers"]["authorization"] == "Bearer sk-or-v1-abc"
    assert captured["body"]["model"] == "openai/gpt-4o-mini"
    assert captured["body"]["messages"] == [
        {"role": "system", "content": "system prompt"},
        {"role": "user", "content": "hi"},
    ]


def test_generate_reply_without_api_key_raises_clear_message():
    with pytest.raises(EngineUnavailable, match="OpenRouter API key"):
        cloud_llm_engine.generate_reply("sp", [], api_key=None, model="openai/gpt-4o-mini")


def test_generate_reply_surfaces_http_error(monkeypatch):
    def fake_urlopen(request, timeout=60):
        raise urllib.error.HTTPError(
            cloud_llm_engine._API_URL, 401, "Unauthorized", {}, io.BytesIO(b"Unauthorized")
        )

    monkeypatch.setattr(cloud_llm_engine.urllib.request, "urlopen", fake_urlopen)
    with pytest.raises(EngineUnavailable, match="401"):
        cloud_llm_engine.generate_reply("sp", [], api_key="bad-key", model="openai/gpt-4o-mini")


def test_generate_json_parses_object_even_with_markdown_fence(monkeypatch):
    def fake_urlopen(request, timeout=60):
        return _FakeResponse(
            {"choices": [{"message": {"content": '```json\n{"mnemonic": "sounds like X"}\n```'}}]}
        )

    monkeypatch.setattr(cloud_llm_engine.urllib.request, "urlopen", fake_urlopen)
    result = cloud_llm_engine.generate_json("sp", "up", api_key="k", model="m")
    assert result == {"mnemonic": "sounds like X"}


def test_generate_json_raises_when_not_valid_json(monkeypatch):
    def fake_urlopen(request, timeout=60):
        return _FakeResponse({"choices": [{"message": {"content": "not json at all"}}]})

    monkeypatch.setattr(cloud_llm_engine.urllib.request, "urlopen", fake_urlopen)
    with pytest.raises(EngineUnavailable, match="valid JSON"):
        cloud_llm_engine.generate_json("sp", "up", api_key="k", model="m")


# ---------------------------------------------------------------- conversation.py provider dispatch


def _fresh_conn(tmp_path, name="cloud_test.db"):
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


def test_llm_target_resolves_cloud_when_mode_is_api(tmp_path):
    conn = _fresh_conn(tmp_path)
    user_id = _make_user(conn)
    _set_cloud_provider(conn, user_id, api_key="sk-or-v1-xyz", model="anthropic/claude-3.5-haiku")

    target = conversation.llm_target(conn, user_id)
    assert target == {"provider": "cloud", "model": "anthropic/claude-3.5-haiku", "api_key": "sk-or-v1-xyz"}


def test_llm_target_defaults_to_local_with_no_settings_row(tmp_path):
    conn = _fresh_conn(tmp_path)
    user_id = _make_user(conn)
    target = conversation.llm_target(conn, user_id)
    assert target["provider"] == "local"


def test_readiness_cloud_ready_iff_api_key_present(tmp_path):
    conn = _fresh_conn(tmp_path)
    user_id = _make_user(conn)
    _set_cloud_provider(conn, user_id, api_key="", model="openai/gpt-4o-mini")
    r = conversation.readiness(conn, user_id, "text")
    assert r["llm"] is False

    _set_cloud_provider(conn, user_id, api_key="sk-or-v1-real", model="openai/gpt-4o-mini")
    r2 = conversation.readiness(conn, user_id, "text")
    assert r2["llm"] is True
    assert "OpenRouter" in r2["llm_model_label"]


def test_ensure_launched_never_blocks_cloud_on_local_load_state(tmp_path):
    """The whole point of the cloud provider: no local "launch" step. Even
    with nothing loaded locally, a cloud target with an API key must pass."""
    conn = _fresh_conn(tmp_path)
    user_id = _make_user(conn)
    target = {"provider": "cloud", "model": "openai/gpt-4o-mini", "api_key": "sk-or-v1-real"}
    conversation._ensure_launched({"llm"}, llm_target=target)  # must not raise


def test_full_engine_status_reports_cloud_llm_ready_from_api_key_alone(tmp_path, monkeypatch):
    conn = _fresh_conn(tmp_path)
    user_id = _make_user(conn)
    monkeypatch.setattr(engine_status, "status", lambda *a, **kw: {"llm": "not_loaded", "stt": "ready", "tts": "ready"})

    _set_cloud_provider(conn, user_id, api_key="", model="openai/gpt-4o-mini")
    st = conversation.full_engine_status(conn, user_id)
    assert st["llm"] == "not_loaded"  # no key yet

    _set_cloud_provider(conn, user_id, api_key="sk-or-v1-real", model="openai/gpt-4o-mini")
    st2 = conversation.full_engine_status(conn, user_id)
    assert st2["llm"] == "ready"
    assert st2["stt"] == "ready" and st2["tts"] == "ready"  # untouched, still real local status


def test_start_session_uses_cloud_engine_and_freezes_model_id(tmp_path, monkeypatch):
    conn = _fresh_conn(tmp_path)
    user_id = _make_user(conn)
    _set_cloud_provider(conn, user_id, api_key="sk-or-v1-real", model="openai/gpt-4o-mini")

    captured = {}

    def fake_generate_reply(system_prompt, history, *, api_key, model, max_tokens=220):
        captured["api_key"], captured["model"] = api_key, model
        return "Hi! Welcome."

    monkeypatch.setattr(cloud_llm_engine, "generate_reply", fake_generate_reply)

    session_id = conversation.start_session(conn, user_id=user_id, scenario="free", channel="text")
    session = conversation.get_session_row(conn, session_id, user_id)
    assert session["model_id"] == "cloud:openai/gpt-4o-mini"
    assert captured == {"api_key": "sk-or-v1-real", "model": "openai/gpt-4o-mini"}

    turns = conversation.get_turns(conn, session_id)
    assert turns[0]["text"] == "Hi! Welcome."


def test_session_keeps_using_cloud_even_after_switching_back_to_local(tmp_path, monkeypatch):
    """Consistent history matters more than switching engines mid-conversation
    — same guarantee the local-only version of this already had."""
    conn = _fresh_conn(tmp_path)
    user_id = _make_user(conn)
    _set_cloud_provider(conn, user_id, api_key="sk-or-v1-real", model="openai/gpt-4o-mini")
    monkeypatch.setattr(cloud_llm_engine, "generate_reply", lambda *a, **kw: "opening")
    session_id = conversation.start_session(conn, user_id=user_id, scenario="free", channel="text")
    session = conversation.get_session_row(conn, session_id, user_id)

    # Switch the user back to local mid-conversation.
    conn.execute("UPDATE user_settings SET llm_mode = 'local' WHERE user_id = ?", (user_id,))
    conn.commit()

    called = {}

    def fake_cloud_reply(system_prompt, history, *, api_key, model, max_tokens=220):
        called["cloud"] = True
        return "still cloud"

    monkeypatch.setattr(cloud_llm_engine, "generate_reply", fake_cloud_reply)
    # If this session incorrectly re-resolved to local now, this would blow
    # up trying to load a local model that was never downloaded.
    user_turn, ai_turn = conversation.submit_user_turn(conn, session, text="hello", audio_bytes=None)
    assert called == {"cloud": True}
    assert ai_turn["text"] == "still cloud"


def test_end_session_uses_cloud_report_generation(tmp_path, monkeypatch):
    conn = _fresh_conn(tmp_path)
    user_id = _make_user(conn)
    _set_cloud_provider(conn, user_id, api_key="sk-or-v1-real", model="openai/gpt-4o-mini")
    monkeypatch.setattr(cloud_llm_engine, "generate_reply", lambda *a, **kw: "hi")
    session_id = conversation.start_session(conn, user_id=user_id, scenario="free", channel="text")
    session = conversation.get_session_row(conn, session_id, user_id)

    def fake_generate_report(transcript, target_words, *, api_key, model):
        return {
            "word_usage": {},
            "fluency_score": 70,
            "vocabulary_reach_score": 60,
            "self_corrections": 0,
            "errors": [],
            "summary": "Cloud-generated summary.",
        }

    monkeypatch.setattr(cloud_llm_engine, "generate_report", fake_generate_report)
    report = conversation.end_session(conn, session)
    assert report["summary"] == "Cloud-generated summary."


# ---------------------------------------------------------------- /engine/llm-provider routes


def test_llm_provider_route_requires_token(client):
    res = client.get("/engine/llm-provider", params={"user_id": "u1"})
    assert res.status_code == 401


def test_llm_provider_defaults_to_local(client, auth_headers):
    user_id = _create_user(client, auth_headers)
    res = client.get("/engine/llm-provider", headers=auth_headers, params={"user_id": user_id})
    assert res.status_code == 200
    body = res.json()
    assert body["provider"] == "local"
    assert body["has_api_key"] is False
    assert body["api_key_preview"] is None


def test_set_llm_provider_persists_and_masks_key_on_read(client, auth_headers):
    user_id = _create_user(client, auth_headers)
    fake_key = "sk-or-v1-" + "x" * 20 + "test1234"
    res = client.post(
        "/engine/llm-provider",
        headers=auth_headers,
        json={
            "user_id": user_id,
            "provider": "cloud",
            "openrouter_api_key": fake_key,
            "openrouter_model": "openai/gpt-4o-mini",
        },
    )
    assert res.status_code == 204

    got = client.get("/engine/llm-provider", headers=auth_headers, params={"user_id": user_id}).json()
    assert got["provider"] == "cloud"
    assert got["openrouter_model"] == "openai/gpt-4o-mini"
    assert got["has_api_key"] is True
    assert got["api_key_preview"] == f"…{fake_key[-4:]}"
    # The raw key is never echoed back.
    assert fake_key not in json.dumps(got)


def test_set_llm_provider_switch_to_local_without_touching_saved_key(client, auth_headers):
    """Switching provider back and forth shouldn't force re-entering the key
    each time — omitting openrouter_api_key must leave it untouched."""
    user_id = _create_user(client, auth_headers)
    client.post(
        "/engine/llm-provider",
        headers=auth_headers,
        json={"user_id": user_id, "provider": "cloud", "openrouter_api_key": "sk-or-v1-keepme"},
    )
    res = client.post("/engine/llm-provider", headers=auth_headers, json={"user_id": user_id, "provider": "local"})
    assert res.status_code == 204
    got = client.get("/engine/llm-provider", headers=auth_headers, params={"user_id": user_id}).json()
    assert got["provider"] == "local"
    assert got["has_api_key"] is True  # key preserved, just not the active provider


def test_selecting_a_local_model_switches_provider_back_to_local(client, auth_headers):
    user_id = _create_user(client, auth_headers)
    client.post(
        "/engine/llm-provider",
        headers=auth_headers,
        json={"user_id": user_id, "provider": "cloud", "openrouter_api_key": "sk-or-v1-x"},
    )
    res = client.post(
        "/engine/models/select", headers=auth_headers, json={"user_id": user_id, "model_key": "qwen2.5-0.5b"}
    )
    assert res.status_code == 204
    provider = client.get("/engine/llm-provider", headers=auth_headers, params={"user_id": user_id}).json()
    assert provider["provider"] == "local"


def test_engine_models_route_shows_no_local_selection_while_cloud_active(client, auth_headers):
    user_id = _create_user(client, auth_headers)
    client.post(
        "/engine/llm-provider",
        headers=auth_headers,
        json={"user_id": user_id, "provider": "cloud", "openrouter_api_key": "sk-or-v1-x"},
    )
    body = client.get("/engine/models", headers=auth_headers, params={"user_id": user_id}).json()
    assert all(o["selected"] is False for o in body["llm"])
