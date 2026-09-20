"""Browsing a vocabulary collection: search, filter, sort, overview.

The list used to be `ORDER BY created_at DESC` with search done in the
browser over whatever had already been fetched — fine for twenty words, wrong
for two thousand, and blind to the one thing that says most about a saved
word: where it stands in the schedule.
"""

from datetime import datetime, timedelta, timezone

import pytest

from app.config import settings
from app.db import get_connection
from app.migrations.runner import run_migrations
from app.services import review, vocabulary
from app.services.fsrs import AGAIN, EASY, GOOD
from app.utils.time import iso8601_utc_now

T0 = datetime(2026, 1, 1, tzinfo=timezone.utc)


def _conn(tmp_path):
    settings.db_path = str(tmp_path / "vocab_browse.db")
    conn = get_connection()
    run_migrations(conn)
    conn.execute(
        "INSERT INTO users (id, display_name, native_language, target_language, created_at) "
        "VALUES ('u1', 'T', 'en', 'en', '2026-01-01T00:00:00Z')"
    )
    conn.execute("INSERT INTO user_settings (user_id) VALUES ('u1')")
    conn.commit()
    return conn


def _add(conn, word, *, cefr=None, definition=None, created="2026-01-01T00:00:00Z", tags=()):
    wid = f"w-{word}"
    conn.execute(
        "INSERT INTO vocab_words (id, user_id, word, lemma, pos, cefr, definition, synonyms, created_at) "
        "VALUES (?, 'u1', ?, ?, 'noun', ?, ?, '[]', ?)",
        (wid, word, word.lower(), cefr, definition, created),
    )
    for t in tags:
        conn.execute(
            "INSERT INTO vocab_tags (vocab_word_id, tag, created_at) VALUES (?, ?, ?)",
            (wid, t, iso8601_utc_now()),
        )
    review.ensure_card(conn, "u1", wid)
    conn.commit()
    return wid


def _words(rows):
    return [r["word"] for r in rows]


# --- search -----------------------------------------------------------------


def test_search_matches_the_definition_not_just_the_word(tmp_path):
    """Half of "find that word I saved" is remembering the meaning but not
    the word — which is exactly when search matters most."""
    conn = _conn(tmp_path)
    _add(conn, "reticent", definition="Unwilling to say much about something.")
    _add(conn, "stark", definition="Severe and unadorned.")
    assert _words(vocabulary.list_words(conn, "u1", query="unwilling")) == ["reticent"]


def test_search_matches_tags(tmp_path):
    conn = _conn(tmp_path)
    _add(conn, "mitigate", tags=("legal",))
    _add(conn, "stark")
    assert _words(vocabulary.list_words(conn, "u1", query="legal")) == ["mitigate"]


def test_search_is_case_insensitive(tmp_path):
    conn = _conn(tmp_path)
    _add(conn, "Reticent")
    assert _words(vocabulary.list_words(conn, "u1", query="RETI")) == ["Reticent"]


def test_an_empty_search_returns_everything(tmp_path):
    conn = _conn(tmp_path)
    _add(conn, "a")
    _add(conn, "b")
    assert len(vocabulary.list_words(conn, "u1", query="   ")) == 2


# --- filters ----------------------------------------------------------------


def test_filter_by_cefr(tmp_path):
    conn = _conn(tmp_path)
    _add(conn, "stark", cefr="B2")
    _add(conn, "reticent", cefr="C1")
    assert _words(vocabulary.list_words(conn, "u1", cefr="C1")) == ["reticent"]
    # Case-insensitive, because a URL is a place people type things.
    assert _words(vocabulary.list_words(conn, "u1", cefr="c1")) == ["reticent"]


def test_filter_by_tag(tmp_path):
    conn = _conn(tmp_path)
    _add(conn, "mitigate", tags=("legal", "work"))
    _add(conn, "stark", tags=("work",))
    assert _words(vocabulary.list_words(conn, "u1", tag="legal")) == ["mitigate"]
    assert sorted(_words(vocabulary.list_words(conn, "u1", tag="work"))) == ["mitigate", "stark"]


def test_filter_by_scheduling_status(tmp_path):
    """The dimension the old list could not see at all."""
    conn = _conn(tmp_path)
    due_id = _add(conn, "duesoon")
    _add(conn, "untouched")
    review.answer_card(conn, "u1", due_id, GOOD, now=T0)
    conn.commit()

    future = (T0 + timedelta(days=400)).strftime("%Y-%m-%dT%H:%M:%SZ")
    assert _words(vocabulary.list_words(conn, "u1", status="due", now_iso=future)) == ["duesoon"]
    assert _words(vocabulary.list_words(conn, "u1", status="new")) == ["untouched"]


def test_struggling_filter_finds_repeatedly_lapsed_words(tmp_path):
    conn = _conn(tmp_path)
    hard_id = _add(conn, "difficult")
    _add(conn, "easy")
    now = T0
    review.answer_card(conn, "u1", hard_id, GOOD, now=now)
    for _ in range(4):
        row = conn.execute("SELECT due FROM review_cards WHERE vocab_word_id = ?", (hard_id,)).fetchone()
        review.answer_card(conn, "u1", hard_id, AGAIN, now=review._parse(row["due"]))
        row = conn.execute("SELECT due FROM review_cards WHERE vocab_word_id = ?", (hard_id,)).fetchone()
        review.answer_card(conn, "u1", hard_id, GOOD, now=review._parse(row["due"]))
    conn.commit()
    assert _words(vocabulary.list_words(conn, "u1", status="struggling")) == ["difficult"]


def test_suspended_words_are_findable_but_not_mixed_in(tmp_path):
    conn = _conn(tmp_path)
    wid = _add(conn, "parked")
    _add(conn, "active")
    review.set_suspended(conn, "u1", wid, True)
    conn.commit()
    assert _words(vocabulary.list_words(conn, "u1", status="suspended")) == ["parked"]


def test_filters_combine(tmp_path):
    conn = _conn(tmp_path)
    _add(conn, "one", cefr="C1", tags=("work",))
    _add(conn, "two", cefr="C1")
    _add(conn, "three", cefr="B2", tags=("work",))
    assert _words(vocabulary.list_words(conn, "u1", cefr="C1", tag="work")) == ["one"]


# --- sorting ----------------------------------------------------------------


def test_alphabetical_sort_ignores_case(tmp_path):
    conn = _conn(tmp_path)
    _add(conn, "banana")
    _add(conn, "Apple")
    _add(conn, "cherry")
    assert _words(vocabulary.list_words(conn, "u1", sort="alphabetical")) == ["Apple", "banana", "cherry"]


def test_recent_and_oldest_are_opposites(tmp_path):
    conn = _conn(tmp_path)
    _add(conn, "first", created="2026-01-01T00:00:00Z")
    _add(conn, "last", created="2026-06-01T00:00:00Z")
    assert _words(vocabulary.list_words(conn, "u1", sort="recent")) == ["last", "first"]
    assert _words(vocabulary.list_words(conn, "u1", sort="oldest")) == ["first", "last"]


def test_unscheduled_words_sort_last_in_scheduling_views(tmp_path):
    """A view that is specifically about scheduling should not open on a
    block of words that have never been scheduled."""
    conn = _conn(tmp_path)
    scheduled = _add(conn, "scheduled")
    _add(conn, "neverseen")
    review.answer_card(conn, "u1", scheduled, GOOD, now=T0)
    conn.commit()
    assert _words(vocabulary.list_words(conn, "u1", sort="due"))[0] == "scheduled"
    assert _words(vocabulary.list_words(conn, "u1", sort="mastery"))[0] == "scheduled"


def test_every_declared_sort_and_filter_actually_runs(tmp_path):
    """Guards the string-built ORDER BY and WHERE clauses: a typo in one of
    them is a 500 that only that one combination reaches."""
    conn = _conn(tmp_path)
    _add(conn, "alpha", cefr="B2", tags=("x",))
    for sort in vocabulary.SORT_ORDERS:
        assert isinstance(vocabulary.list_words(conn, "u1", sort=sort), list)
    for status in vocabulary.STATUS_FILTERS:
        assert isinstance(vocabulary.list_words(conn, "u1", status=status), list)


# --- overview ---------------------------------------------------------------


def test_overview_counts_the_collection(tmp_path):
    conn = _conn(tmp_path)
    _add(conn, "a", cefr="B2", tags=("work",))
    _add(conn, "b", cefr="B2")
    _add(conn, "c", cefr="C1", tags=("work", "film"))
    ov = vocabulary.overview(conn, "u1")
    assert ov["total"] == 3
    assert ov["by_cefr"] == {"B2": 2, "C1": 1}
    assert ov["tags"][0] == {"tag": "work", "count": 2}
    assert ov["new_count"] == 3


def test_overview_is_empty_not_broken_for_a_new_user(tmp_path):
    conn = _conn(tmp_path)
    ov = vocabulary.overview(conn, "u1")
    assert ov["total"] == 0 and ov["tags"] == [] and ov["by_cefr"] == {}


# --- routes -----------------------------------------------------------------


def test_list_route_rejects_unknown_filters(client, auth_headers):
    res = client.post(
        "/users",
        headers=auth_headers,
        json={"display_name": "R", "native_language": "en", "target_language": "en", "data_folder": "~/F"},
    )
    user_id = res.json()["id"]
    bad = client.get(
        "/vocabulary", headers=auth_headers, params={"user_id": user_id, "status_filter": "nonsense"}
    )
    assert bad.status_code == 400
    bad_sort = client.get(
        "/vocabulary", headers=auth_headers, params={"user_id": user_id, "sort": "nonsense"}
    )
    assert bad_sort.status_code == 400


def test_list_route_returns_scheduling_fields(client, auth_headers):
    res = client.post(
        "/users",
        headers=auth_headers,
        json={"display_name": "R", "native_language": "en", "target_language": "en", "data_folder": "~/F"},
    )
    user_id = res.json()["id"]
    client.post(
        "/vocabulary/manual",
        headers=auth_headers,
        json={"user_id": user_id, "word": "mitigate", "pos": "verb", "definition": "d", "synonyms": []},
    )
    row = client.get("/vocabulary", headers=auth_headers, params={"user_id": user_id}).json()[0]
    assert row["card_state"] == "new"
    assert row["mastery_level"] == 0
    assert row["mastery_label"] == "unseen"
    assert row["reps"] == 0


# --- usage counts -----------------------------------------------------------


def test_conversation_usage_excludes_flashcard_answers(tmp_path):
    """The bug this pins was visible on screen: a word answered only on a
    flashcard reported "conversation usage: again 1x". review_logs held only
    conversation rows until 0015 gave flashcard reviews the same table, and
    this query never learned to tell them apart. "again" is not something
    anyone can do in a conversation."""
    from app.services import conversation

    conn = _conn(tmp_path)
    wid = _add(conn, "excerpt")
    review.answer_card(conn, "u1", wid, AGAIN, now=T0)
    conn.commit()

    assert conversation.word_usage_counts(conn, wid) == {}
    assert conversation.flashcard_review_counts(conn, wid) == {"again": 1}


def test_the_two_sources_are_counted_separately(tmp_path):
    from app.services import conversation

    conn = _conn(tmp_path)
    wid = _add(conn, "mitigate")
    conn.execute(
        "INSERT INTO conversation_sessions (id, user_id, scenario, channel, target_word_ids, started_at) "
        "VALUES ('s1', 'u1', 'free', 'text', '[]', '2026-01-01T00:00:00Z')"
    )
    conn.commit()
    review.apply_conversation_outcomes(conn, "u1", "s1", [(wid, "spontaneous")], now=T0)
    review.answer_card(conn, "u1", wid, EASY, now=T0)
    conn.commit()

    assert conversation.word_usage_counts(conn, wid) == {"spontaneous": 1}
    assert conversation.flashcard_review_counts(conn, wid) == {"easy": 1}


# --- pronunciation ----------------------------------------------------------


def test_pronunciation_is_synthesized_once_and_cached(tmp_path, monkeypatch):
    """Real synthesis is seconds of work and a word's pronunciation does not
    change, so the second request must not pay for it again."""
    from app.services.voice import tts_engine

    conn = _conn(tmp_path)
    wid = _add(conn, "excerpt")
    calls: list[str] = []
    monkeypatch.setattr(tts_engine, "synthesize", lambda text: calls.append(text) or b"RIFFaudio")

    first = vocabulary.pronunciation_path(wid, "excerpt", "word", "kokoro")
    second = vocabulary.pronunciation_path(wid, "excerpt", "word", "kokoro")
    assert first == second
    assert calls == ["excerpt"], "synthesis should happen exactly once"
    assert first.read_bytes() == b"RIFFaudio"
    assert not list(first.parent.glob("*.part"))


def test_each_engine_and_part_gets_its_own_clip(tmp_path, monkeypatch):
    """The file IS that engine's voice, and the word and the sentence are
    different audio — sharing one path would serve the wrong one."""
    from app.services.voice import pocket_tts_engine, tts_engine

    conn = _conn(tmp_path)
    wid = _add(conn, "excerpt")
    monkeypatch.setattr(tts_engine, "synthesize", lambda t: b"kokoro")
    monkeypatch.setattr(pocket_tts_engine, "synthesize", lambda t: b"pocket")

    paths = {
        vocabulary.pronunciation_path(wid, "excerpt", "word", "kokoro"),
        vocabulary.pronunciation_path(wid, "A sentence.", "sentence", "kokoro"),
        vocabulary.pronunciation_path(wid, "excerpt", "word", "pocket"),
    }
    assert len(paths) == 3


def test_deleting_a_word_removes_its_pronunciation(tmp_path, monkeypatch):
    """Derived files outside any DB cascade leak forever unless something
    clears them."""
    from app.services.voice import tts_engine

    conn = _conn(tmp_path)
    wid = _add(conn, "excerpt")
    monkeypatch.setattr(tts_engine, "synthesize", lambda t: b"RIFFaudio")
    path = vocabulary.pronunciation_path(wid, "excerpt", "word", "kokoro")
    assert path.exists()

    assert vocabulary.delete_word(conn, "u1", wid) is True
    conn.commit()
    assert not path.exists()


def test_pronounce_route_404s_for_a_word_with_no_example(client, auth_headers):
    res = client.post(
        "/users",
        headers=auth_headers,
        json={"display_name": "R", "native_language": "en", "target_language": "en", "data_folder": "~/F"},
    )
    user_id = res.json()["id"]
    saved = client.post(
        "/vocabulary/manual",
        headers=auth_headers,
        json={"user_id": user_id, "word": "excerpt", "pos": "noun", "definition": "d", "synonyms": []},
    )
    wid = saved.json()["word"]["id"]
    # No example sentence was supplied, so there is nothing to speak.
    assert client.get(
        f"/vocabulary/{wid}/pronounce",
        headers=auth_headers,
        params={"user_id": user_id, "part": "sentence"},
    ).status_code == 404


def test_pronounce_route_refuses_someone_elses_word(client, auth_headers):
    res = client.post(
        "/users",
        headers=auth_headers,
        json={"display_name": "R", "native_language": "en", "target_language": "en", "data_folder": "~/F"},
    )
    user_id = res.json()["id"]
    assert client.get(
        "/vocabulary/not-mine/pronounce", headers=auth_headers, params={"user_id": user_id}
    ).status_code == 404


# --- CEFR coverage ----------------------------------------------------------


def test_the_band_table_extends_the_curated_lexicon():
    """Coverage went from ~1k hand-checked words to ~9k. Most saved words
    showed "CEFR —" simply because nothing knew their level."""
    from app.services import cefr_lexicon

    assert cefr_lexicon.size() > 900, "curated lexicon should still be loaded"
    assert cefr_lexicon.band_table_size() > 8000

    # In the band table but not the curated list — these used to be unrated.
    for word in ("abolish", "ubiquitous", "accessibility"):
        assert cefr_lexicon.band_of(word) in cefr_lexicon.CEFR_ORDER, word


def test_the_curated_lexicon_still_wins():
    """It is hand-checked and carries the definition and example the reader
    panel shows; the band table must not override it."""
    from app.services import cefr_lexicon

    entry = cefr_lexicon.lookup("reticent")
    if entry is not None:
        assert cefr_lexicon.band_of("reticent") == entry.cefr


def test_inflected_forms_still_resolve_to_a_band():
    from app.services import cefr_lexicon

    assert cefr_lexicon.band_of("cats") == cefr_lexicon.band_of("cat")
    assert cefr_lexicon.band_of("abolished") == cefr_lexicon.band_of("abolish")


def test_unknown_words_stay_unrated():
    """The lexicon's own rule: a missing word does not tint. Treating unknown
    as hard would light up every proper noun on the page."""
    from app.services import cefr_lexicon

    assert cefr_lexicon.band_of("zzzznotaword") is None
    assert cefr_lexicon.band_of("") is None


def test_dictionary_search_reports_a_band_from_the_wider_table(client, auth_headers, monkeypatch):
    """The bug behind "CEFR —" on almost every entry: the search read the
    band off the curated lexicon only."""
    from app.services import dictionary_lookup

    class _Result:
        word = "abolish"
        found = True
        ipa = None
        audio_url = None
        senses = ()
        synonyms = ()

    monkeypatch.setattr(dictionary_lookup, "search", lambda w, timeout=None: _Result())
    body = client.get("/vocabulary/dictionary-search", headers=auth_headers, params={"w": "abolish"}).json()
    assert body["cefr"] == "B2"


# --- AI enrichment ----------------------------------------------------------


def test_enrichment_drops_examples_that_omit_the_word(monkeypatch, tmp_path):
    """A sentence that does not contain the word teaches nothing about it, and
    a 1B model produces them regularly — observed asking for "excerpt" and
    getting "I need to read the entire article before I can understand it."."""
    from app.services import vocabulary_ai

    conn = _conn(tmp_path)
    monkeypatch.setattr(vocabulary_ai, "_llm_target", lambda conn, user_id: {"provider": "local"})
    monkeypatch.setattr(
        vocabulary_ai,
        "_generate_json",
        lambda *a, **kw: {
            "definition": "A short passage.",
            "examples": [
                "I need to read the entire article first.",
                "She read an excerpt from the novel.",
                "The excerpts were printed together.",
            ],
            "mnemonic": "ex-CERPT: a cut-out piece",
            "usage_note": "formal writing",
            "synonyms": ["passage", "excerpt"],
        },
    )
    out = vocabulary_ai.enrich_word(conn, user_id="u1", word="excerpt")
    assert out["examples"] == [
        "She read an excerpt from the novel.",
        "The excerpts were printed together.",
    ]
    # The word is not a synonym of itself.
    assert out["synonyms"] == ["passage"]
    assert out["mnemonic"]


def test_enrichment_works_without_any_context(monkeypatch, tmp_path):
    """A word can be added from nothing but itself — requiring a context
    sentence is what made the AI path a separate tab rather than part of the
    normal flow."""
    from app.services import vocabulary_ai

    conn = _conn(tmp_path)
    captured = {}

    def _fake(target, system_prompt, user_prompt, **kw):
        captured["prompt"] = user_prompt
        return {"definition": "d", "examples": [], "mnemonic": "m", "usage_note": "n", "synonyms": []}

    monkeypatch.setattr(vocabulary_ai, "_llm_target", lambda conn, user_id: {"provider": "local"})
    monkeypatch.setattr(vocabulary_ai, "_generate_json", _fake)
    out = vocabulary_ai.enrich_word(conn, user_id="u1", word="collate")
    assert out["definition"] == "d"
    assert "collate" in captured["prompt"]


def test_speech_is_cached_by_content(tmp_path, monkeypatch):
    from app.services.voice import tts_engine

    _conn(tmp_path)
    calls: list[str] = []
    monkeypatch.setattr(tts_engine, "synthesize", lambda t: calls.append(t) or b"RIFF")

    a = vocabulary.speech_path("hello there", "kokoro")
    b = vocabulary.speech_path("hello there", "kokoro")
    c = vocabulary.speech_path("different text", "kokoro")
    assert a == b and a != c
    assert calls == ["hello there", "different text"]


def test_speak_route_refuses_empty_and_overlong_text(client, auth_headers):
    res = client.post(
        "/users",
        headers=auth_headers,
        json={"display_name": "R", "native_language": "en", "target_language": "en", "data_folder": "~/F"},
    )
    user_id = res.json()["id"]
    assert client.get("/vocabulary/speak", headers=auth_headers,
                      params={"user_id": user_id, "text": "   "}).status_code == 400
    assert client.get("/vocabulary/speak", headers=auth_headers,
                      params={"user_id": user_id, "text": "x" * 500}).status_code == 400


# --- AI enrichment is stored, not discarded ---------------------------------


def _save(client, auth_headers, user_id, **extra):
    payload = {
        "user_id": user_id, "word": "our", "pos": "determiner",
        "definition": "Belonging to us.", "synonyms": [],
    }
    payload.update(extra)
    return client.post("/vocabulary/manual", headers=auth_headers, json=payload)


def _user(client, auth_headers):
    res = client.post(
        "/users",
        headers=auth_headers,
        json={"display_name": "R", "native_language": "en", "target_language": "en", "data_folder": "~/F"},
    )
    return res.json()["id"]


def test_ai_enrichment_survives_the_save(client, auth_headers):
    """It used to be thrown away: the mnemonic had nowhere to go, the second
    example was dropped, and the register note was flattened into a free-text
    note where nothing could read it back."""
    user_id = _user(client, auth_headers)
    _save(
        client, auth_headers, user_id,
        ai_definition="Something that belongs to us.",
        ai_examples=["Our house is blue.", "That book is ours."],
        ai_mnemonic="OUR = belongs to US",
        ai_usage_note="everyday speech",
        ai_sense_definition="Belonging to us.",
    )
    row = client.get("/vocabulary", headers=auth_headers, params={"user_id": user_id}).json()[0]
    assert row["ai_definition"] == "Something that belongs to us."
    assert row["ai_examples"] == ["Our house is blue.", "That book is ours."]
    assert row["ai_mnemonic"] == "OUR = belongs to US"
    assert row["ai_usage_note"] == "everyday speech"


def test_the_dictionary_definition_is_not_overwritten_by_the_ai(client, auth_headers):
    """The dictionary is authoritative about what a word means. Letting the
    model replace that lost the wording worth having a dictionary for."""
    user_id = _user(client, auth_headers)
    _save(client, auth_headers, user_id, ai_definition="A plainer phrasing.")
    row = client.get("/vocabulary", headers=auth_headers, params={"user_id": user_id}).json()[0]
    assert row["definition"] == "Belonging to us."
    assert row["ai_definition"] == "A plainer phrasing."


def test_the_sense_the_enrichment_describes_is_recorded(client, auth_headers):
    """An entry for "our" has ten senses. Enrichment of sense 2 says nothing
    about sense 7, and the page has to be able to say which one it means."""
    user_id = _user(client, auth_headers)
    _save(
        client, auth_headers, user_id,
        definition="Belonging to us, including the person addressed.",
        ai_definition="Ours, counting you in.",
        ai_sense_definition="Belonging to us, including the person addressed.",
    )
    row = client.get("/vocabulary", headers=auth_headers, params={"user_id": user_id}).json()[0]
    assert row["ai_sense_definition"] == "Belonging to us, including the person addressed."


def test_a_word_with_no_enrichment_reports_empty_not_null(client, auth_headers):
    user_id = _user(client, auth_headers)
    _save(client, auth_headers, user_id)
    row = client.get("/vocabulary", headers=auth_headers, params={"user_id": user_id}).json()[0]
    assert row["ai_definition"] is None
    assert row["ai_examples"] == []


def test_re_adding_a_word_fills_gaps_without_clobbering(client, auth_headers):
    """Re-adding a word to attach a mnemonic should get the mnemonic, and
    should not silently lose the definition already there."""
    user_id = _user(client, auth_headers)
    _save(client, auth_headers, user_id, ai_definition="First phrasing.")
    _save(client, auth_headers, user_id, ai_mnemonic="a hook", ai_definition="Second phrasing.")

    rows = client.get("/vocabulary", headers=auth_headers, params={"user_id": user_id}).json()
    assert len(rows) == 1, "re-adding must not duplicate the entry"
    assert rows[0]["ai_definition"] == "First phrasing.", "existing enrichment must not be replaced"
    assert rows[0]["ai_mnemonic"] == "a hook", "a missing field should still be filled"
