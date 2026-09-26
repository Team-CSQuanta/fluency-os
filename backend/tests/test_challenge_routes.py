"""The challenge endpoints, over HTTP.

Every test here goes through the router rather than calling the service. The
enrichment service was covered thoroughly and worked perfectly; the endpoint in
front of it raised NameError on its first line, because `run_in_threadpool` was
used without being imported. Nothing exercised the route, so nothing noticed,
and "Show one richer version" did nothing at all in the interface.
"""

import json

import pytest

from app.config import settings
from app.db import get_connection
from app.services import vocabulary_ai
from app.utils.ids import uuid7
from app.utils.time import iso8601_utc_now

_CAPTIONS = [
    "A man stirs a pot of boiling pasta.",
    "A person cooks noodles on a stove.",
    "A chef boils pasta in a large pot.",
    "A man cooking spaghetti on the stovetop.",
    "A guy in a kitchen stirring a pot.",
    "A man prepares a pasta dish.",
    "A person stirs noodles in boiling water.",
    "A man wearing red cooks pasta.",
    "Someone is preparing food in a kitchen.",
    "A man in a red shirt is cooking pasta.",
]


@pytest.fixture()
def seeded(client):
    """A learner with one saved word and one scored VATEX round."""
    conn = get_connection(settings.db_path)
    conn.execute(
        "INSERT INTO users (id, display_name, native_language, target_language, cefr_level, "
        "created_at) VALUES ('u1','L','bn','en','B1',?)",
        (iso8601_utc_now(),),
    )
    conn.execute(
        "INSERT INTO vocab_words (id, user_id, word, lemma, pos, definition, created_at) "
        "VALUES ('w1','u1','stove','stove','noun','a cooking appliance',?)",
        (iso8601_utc_now(),),
    )
    conn.commit()
    conn.close()
    return client


def _round(*, status: str = "scored", captions: list[str] | None = None) -> str:
    conn = get_connection(settings.db_path)
    rid = uuid7()
    conn.execute(
        "INSERT INTO challenge_rounds (id, user_id, kind, source, video_id, start_s, end_s, "
        "media_title, reference_captions, target_words, prompt, status, started_at) "
        "VALUES (?, 'u1', 'describe', 'vatex', 'vid1', 0, 10, 't', ?, '[]', 'p', ?, ?)",
        (rid, json.dumps(_CAPTIONS if captions is None else captions), status, iso8601_utc_now()),
    )
    conn.commit()
    conn.close()
    return rid


def _fake_model(monkeypatch, description="A man cooks pasta on a stove."):
    monkeypatch.setattr(vocabulary_ai, "_llm_target", lambda conn, user_id: {"provider": "local"})
    monkeypatch.setattr(
        vocabulary_ai,
        "_generate_json",
        lambda *a, **k: {"description": description, "used_words": []},
    )


def test_enrich_endpoint_returns_the_description(seeded, auth_headers, monkeypatch):
    """The test that was missing. A NameError in the endpoint body is a 500,
    and no amount of service-level coverage sees it."""
    _fake_model(monkeypatch)
    rid = _round()
    r = seeded.post(f"/challenge/rounds/{rid}/enrich?user_id=u1", headers=auth_headers, json={})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["description"] == "A man cooks pasta on a stove."
    assert [w["word"] for w in body["used_words"]] == ["stove"]
    assert body["cached"] is False


def test_enrich_endpoint_persists_what_it_wrote(seeded, auth_headers, monkeypatch):
    """It costs a real model call, so the request that made it has to commit —
    a second ask must come back from the round, not from the model again."""
    _fake_model(monkeypatch)
    rid = _round()
    seeded.post(f"/challenge/rounds/{rid}/enrich?user_id=u1", headers=auth_headers, json={})

    monkeypatch.setattr(
        vocabulary_ai,
        "_generate_json",
        lambda *a, **k: pytest.fail("the model was asked twice for the same round"),
    )
    again = seeded.post(f"/challenge/rounds/{rid}/enrich?user_id=u1", headers=auth_headers, json={})
    assert again.status_code == 200, again.text
    assert again.json()["cached"] is True


def test_enrich_refuses_a_round_that_has_not_been_attempted(seeded, auth_headers):
    """These ten descriptions are the answer. Handing them over before the
    learner has described the scene is handing over the answer."""
    rid = _round(status="open")
    r = seeded.post(f"/challenge/rounds/{rid}/enrich?user_id=u1", headers=auth_headers, json={})
    assert r.status_code == 409
    assert "Describe the scene first" in r.json()["detail"]


def test_enrich_reports_a_round_with_nothing_to_build_on(seeded, auth_headers):
    """A library round has no reference descriptions; that is a 400 with a
    sentence in it, not a 500."""
    rid = _round(captions=[])
    r = seeded.post(f"/challenge/rounds/{rid}/enrich?user_id=u1", headers=auth_headers, json={})
    assert r.status_code == 400
    assert "no reference" in r.json()["detail"]


def test_enrich_needs_the_handshake_token(seeded):
    rid = _round()
    assert seeded.post(f"/challenge/rounds/{rid}/enrich?user_id=u1", json={}).status_code == 401
