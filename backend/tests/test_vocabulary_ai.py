"""AI-powered Vocabulary features (explain-in-context, examples, mnemonic,
practice) — all backed by the same local LLM Conversation uses via
vocabulary_ai.py. The LLM call itself (llm_chat_engine.generate_json) is
mocked everywhere here, same precedent as test_conversation.py's fake_llm —
the real model is never loaded in the automated suite.
"""

import pytest

from app.services import conversation, vocabulary_ai
from app.services.voice import llm_chat_engine


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


def _save_word(client, auth_headers, user_id, word="ephemeral", definition="lasting a very short time"):
    res = client.post(
        "/vocabulary/manual",
        headers=auth_headers,
        json={"user_id": user_id, "word": word, "pos": "adjective", "definition": definition},
    )
    assert res.status_code == 200
    return res.json()["word"]["id"]


@pytest.fixture()
def fake_generate_json(monkeypatch):
    """These tests exercise the vocabulary_ai orchestration, not the "is the
    model downloaded/launched" gates — those have their own dedicated tests
    below, mirroring test_conversation.py's split."""
    state = {"response": {}, "calls": []}

    def fake(system_prompt, user_prompt, *, repo_id, filename, max_tokens=300, temperature=0.4):
        state["calls"].append({"system_prompt": system_prompt, "user_prompt": user_prompt, "max_tokens": max_tokens})
        return state["response"]

    monkeypatch.setattr(llm_chat_engine, "generate_json", fake)
    monkeypatch.setattr(conversation, "_ensure_ready", lambda *a, **kw: None)
    monkeypatch.setattr(conversation, "_ensure_launched", lambda *a, **kw: None)
    return state


# ---------------------------------------------------------------- ai-explain


def test_ai_explain_route_returns_structured_definition(client, auth_headers, fake_generate_json):
    user_id = _create_user(client, auth_headers)
    fake_generate_json["response"] = {
        "pos": "adjective",
        "definition": "lasting for only a short time",
        "example": "The morning fog was ephemeral, gone by nine.",
        "synonyms": ["fleeting", "transient"],
    }

    res = client.post(
        "/vocabulary/ai-explain",
        headers=auth_headers,
        json={"user_id": user_id, "word": "ephemeral", "context": "The art installation was ephemeral."},
    )
    assert res.status_code == 200
    body = res.json()
    assert body == {
        "word": "ephemeral",
        "pos": "adjective",
        "definition": "lasting for only a short time",
        "example": "The morning fog was ephemeral, gone by nine.",
        "synonyms": ["fleeting", "transient"],
    }
    assert "ephemeral" in fake_generate_json["calls"][0]["user_prompt"]
    assert "art installation" in fake_generate_json["calls"][0]["user_prompt"]


def test_ai_explain_route_requires_word_and_context(client, auth_headers, fake_generate_json):
    user_id = _create_user(client, auth_headers)
    res = client.post(
        "/vocabulary/ai-explain", headers=auth_headers, json={"user_id": user_id, "word": "  ", "context": ""}
    )
    assert res.status_code == 400


def test_ai_explain_route_blocked_when_no_model_downloaded(client, auth_headers):
    # No fake_generate_json fixture here — the real _ensure_ready gate runs.
    user_id = _create_user(client, auth_headers)
    res = client.post(
        "/vocabulary/ai-explain",
        headers=auth_headers,
        json={"user_id": user_id, "word": "ephemeral", "context": "It was ephemeral."},
    )
    assert res.status_code == 503


def test_ai_explain_route_requires_token(client):
    res = client.post("/vocabulary/ai-explain", json={"user_id": "u1", "word": "x", "context": "y"})
    assert res.status_code == 401


# ---------------------------------------------------------------- ai-examples


def test_ai_examples_route_returns_generated_sentences(client, auth_headers, fake_generate_json):
    user_id = _create_user(client, auth_headers)
    word_id = _save_word(client, auth_headers, user_id)
    fake_generate_json["response"] = {
        "examples": ["Her fame proved ephemeral.", "The rainbow was ephemeral, fading fast.", "Trends are ephemeral."]
    }

    res = client.post(f"/vocabulary/{word_id}/ai-examples", headers=auth_headers, params={"user_id": user_id})
    assert res.status_code == 200
    assert len(res.json()["examples"]) == 3
    assert "ephemeral" in fake_generate_json["calls"][0]["user_prompt"]


def test_ai_examples_route_respects_count_and_caps_it(client, auth_headers, fake_generate_json):
    user_id = _create_user(client, auth_headers)
    word_id = _save_word(client, auth_headers, user_id)
    fake_generate_json["response"] = {"examples": [f"Sentence {i}." for i in range(10)]}

    res = client.post(
        f"/vocabulary/{word_id}/ai-examples", headers=auth_headers, params={"user_id": user_id, "count": 20}
    )
    assert res.status_code == 200
    assert len(res.json()["examples"]) == 5  # capped


def test_ai_examples_route_404s_for_unowned_word(client, auth_headers, fake_generate_json):
    user_id = _create_user(client, auth_headers)
    res = client.post(f"/vocabulary/does-not-exist/ai-examples", headers=auth_headers, params={"user_id": user_id})
    assert res.status_code == 404


# ---------------------------------------------------------------- ai-mnemonic


def test_ai_mnemonic_route_generates_and_persists(client, auth_headers, fake_generate_json):
    user_id = _create_user(client, auth_headers)
    word_id = _save_word(client, auth_headers, user_id)
    fake_generate_json["response"] = {"mnemonic": "EPHEMERAL sounds like 'a fair mural' — painted, then gone."}

    res = client.post(f"/vocabulary/{word_id}/ai-mnemonic", headers=auth_headers, params={"user_id": user_id})
    assert res.status_code == 200
    assert "mural" in res.json()["mnemonic"]

    # Persisted — shows up on the word itself without regenerating.
    detail = client.get(f"/vocabulary/by-word/ephemeral", headers=auth_headers, params={"user_id": user_id}).json()
    assert detail["ai_mnemonic"] == "EPHEMERAL sounds like 'a fair mural' — painted, then gone."


def test_ai_mnemonic_route_regenerate_overwrites_previous(client, auth_headers, fake_generate_json):
    user_id = _create_user(client, auth_headers)
    word_id = _save_word(client, auth_headers, user_id)
    fake_generate_json["response"] = {"mnemonic": "first version"}
    client.post(f"/vocabulary/{word_id}/ai-mnemonic", headers=auth_headers, params={"user_id": user_id})

    fake_generate_json["response"] = {"mnemonic": "second version"}
    res = client.post(f"/vocabulary/{word_id}/ai-mnemonic", headers=auth_headers, params={"user_id": user_id})
    assert res.json()["mnemonic"] == "second version"


# ---------------------------------------------------------------- ai-practice


def test_ai_practice_route_returns_question(client, auth_headers, fake_generate_json):
    user_id = _create_user(client, auth_headers)
    word_id = _save_word(client, auth_headers, user_id)
    fake_generate_json["response"] = {"question": "The exhibit was _____, open for one night only."}

    res = client.post(f"/vocabulary/{word_id}/ai-practice", headers=auth_headers, params={"user_id": user_id})
    assert res.status_code == 200
    assert "_____" in res.json()["question"]


def test_ai_practice_route_404s_for_unowned_word(client, auth_headers, fake_generate_json):
    user_id = _create_user(client, auth_headers)
    res = client.post("/vocabulary/does-not-exist/ai-practice", headers=auth_headers, params={"user_id": user_id})
    assert res.status_code == 404
