"""The settings page's endpoints.

Until these existed the page could not read its own values, so it showed a
hard-coded list. The tests worth having are therefore about honesty: that a
read reflects the row, that a write changes only what was sent, and that an
API key is never handed back out.
"""

import json

import pytest

from app.config import settings
from app.db import get_connection
from app.utils.time import iso8601_utc_now


@pytest.fixture()
def user(client):
    conn = get_connection(settings.db_path)
    conn.execute(
        "INSERT INTO users (id, display_name, native_language, target_language, cefr_level, "
        "created_at) VALUES ('u1','L','bn','en','B1',?)",
        (iso8601_utc_now(),),
    )
    conn.commit()
    conn.close()
    return client


def test_settings_exist_for_a_user_who_skipped_onboarding(user, auth_headers):
    """No settings row is not an error — onboarding can be skipped, and the
    schema's own defaults are what that user is actually running on."""
    r = user.get("/users/u1/settings", headers=auth_headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["target_retention"] == 0.9
    assert body["new_cards_per_day"] == 15
    assert body["conversation_mic_sensitivity"] == "balanced"
    assert body["conversation_turn_pace"] == "natural"
    assert body["notifications_enabled"] is True


def test_patch_changes_only_what_was_sent(user, auth_headers):
    """The whole point of PATCH here. A whole-row write from a page that does
    not show every column resets the ones it left out."""
    user.patch("/users/u1/settings", headers=auth_headers, json={"new_cards_per_day": 40})
    before = user.get("/users/u1/settings", headers=auth_headers).json()
    assert before["new_cards_per_day"] == 40

    user.patch("/users/u1/settings", headers=auth_headers, json={"conversation_turn_pace": "patient"})
    after = user.get("/users/u1/settings", headers=auth_headers).json()
    assert after["conversation_turn_pace"] == "patient"
    assert after["new_cards_per_day"] == 40, "an unmentioned setting must survive"


def test_patch_answers_with_the_whole_object(user, auth_headers):
    """So the page never has to guess what the row now holds."""
    r = user.patch("/users/u1/settings", headers=auth_headers, json={"daily_page_goal": 35})
    assert r.status_code == 200
    assert r.json()["daily_page_goal"] == 35
    assert "conversation_mic_sensitivity" in r.json()


@pytest.mark.parametrize(
    "payload",
    [
        {"target_retention": 0.5},  # below FSRS's useful range
        {"target_retention": 0.999},
        {"new_cards_per_day": -1},
        {"quiet_hours_start": "10pm"},
        {"conversation_turn_pace": "instant"},
    ],
)
def test_nonsense_is_refused(user, auth_headers, payload):
    assert user.patch("/users/u1/settings", headers=auth_headers, json=payload).status_code == 422


def test_an_api_key_is_never_handed_back(user, auth_headers):
    """It is reported as set, never echoed. The page needs to say "set" rather
    than show a box that looks empty when it is not."""
    conn = get_connection(settings.db_path)
    conn.execute(
        "INSERT INTO user_settings (user_id, openrouter_api_key) VALUES ('u1', 'sk-or-secret') "
        "ON CONFLICT(user_id) DO UPDATE SET openrouter_api_key = excluded.openrouter_api_key"
    )
    conn.commit()
    conn.close()

    r = user.get("/users/u1/settings", headers=auth_headers)
    assert r.json()["openrouter_key_set"] is True
    assert r.json()["gemini_key_set"] is False
    assert "secret" not in r.text, "the key itself must not appear anywhere in the payload"


def test_settings_of_a_missing_user_are_a_404(user, auth_headers):
    assert user.get("/users/nobody/settings", headers=auth_headers).status_code == 404


# --- the local dictionary cache --------------------------------------------


def _cache_row(word: str) -> tuple:
    return (word, word, None, None, json.dumps([{"pos": "n", "definition": "d", "example": None}]),
            json.dumps([]), "online", iso8601_utc_now())


def test_dictionary_cache_reports_what_it_holds(user, auth_headers):
    conn = get_connection(settings.db_path)
    conn.executemany(
        "INSERT INTO dictionary_entries (word, display, ipa, audio_url, senses, synonyms, source,"
        " cached_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [_cache_row("chisel"), _cache_row("frost")],
    )
    conn.commit()
    conn.close()

    r = user.get("/vocabulary/dictionary-cache", headers=auth_headers)
    assert r.status_code == 200, r.text
    assert r.json()["entries"] == 2
    assert r.json()["last_cached_at"] is not None


def test_clearing_the_cache_leaves_saved_words_alone(user, auth_headers):
    """A saved word carries its own snapshot of the definition, taken when it
    was saved, precisely so that it does not depend on this table."""
    conn = get_connection(settings.db_path)
    conn.execute(
        "INSERT INTO dictionary_entries (word, display, ipa, audio_url, senses, synonyms, source,"
        " cached_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        _cache_row("chisel"),
    )
    conn.commit()
    conn.close()

    saved = user.post(
        "/vocabulary/manual",
        headers=auth_headers,
        json={"user_id": "u1", "word": "chisel", "pos": "noun", "definition": "a cutting tool"},
    )
    assert saved.status_code == 200, saved.text

    cleared = user.delete("/vocabulary/dictionary-cache", headers=auth_headers)
    # Also proves the route is not shadowed by DELETE /vocabulary/{word_id},
    # which would read "dictionary-cache" as an id and answer 404.
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["entries"] == 0
    assert cleared.json()["last_cached_at"] is None

    still_there = user.get("/vocabulary?user_id=u1", headers=auth_headers).json()
    assert [w["word"] for w in still_there] == ["chisel"]
    assert user.get("/vocabulary/dictionary-cache", headers=auth_headers).json()["entries"] == 0
