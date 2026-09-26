"""CEFR levels on saved words.

A word captured from a video showed "CEFR —" even for common vocabulary,
because save_manual_word read the level from the curated lexicon (about a
thousand words) instead of band_of, which also consults the 8,832-entry band
table. The level is snapshotted at save time by design, so a word saved
without one never acquired it later.
"""

import sqlite3

import pytest

from app.db import get_connection
from app.migrations.runner import run_migrations
from app.services import cefr_lexicon, vocabulary
from app.utils.ids import uuid7
from app.utils.time import iso8601_utc_now


@pytest.fixture()
def conn(tmp_path) -> sqlite3.Connection:
    connection = get_connection(str(tmp_path / "vocab.db"))
    run_migrations(connection)
    connection.execute(
        "INSERT INTO users (id, display_name, native_language, target_language, created_at) VALUES (?,?,?,?,?)",
        ("u1", "Learner", "bn", "en", iso8601_utc_now()),
    )
    connection.commit()
    yield connection
    connection.close()


def _save(conn, word, **kwargs):
    row, _existed = vocabulary.save_manual_word(
        conn,
        user_id="u1",
        word=word,
        pos=kwargs.get("pos", "noun"),
        definition=kwargs.get("definition", "A definition."),
        example=None,
        synonyms=[],
        ipa=None,
        audio_url=None,
        note_text=None,
    )
    return row


def test_a_word_only_the_band_table_knows_still_gets_its_level(conn):
    """"findings" is not in the curated lexicon but the band table rates it
    B1 — exactly the case that used to save as NULL."""
    assert cefr_lexicon.lookup("findings") is None
    assert cefr_lexicon.band_of("findings") == "B1"
    assert _save(conn, "findings")["cefr"] == "B1"


def test_a_curated_word_keeps_the_hand_checked_level(conn):
    assert _save(conn, "reticent")["cefr"] == "C1"


def test_an_inflected_form_is_rated_by_its_lemma(conn):
    assert _save(conn, "experiences")["cefr"] == cefr_lexicon.band_of("experience")


def test_a_word_nothing_knows_is_left_blank_rather_than_guessed(conn):
    """No source rates "anecdote". Inventing a band would be worse than
    showing none — a learner filters and plans by these."""
    assert cefr_lexicon.band_of("anecdote") is None
    assert _save(conn, "anecdote")["cefr"] is None


def test_backfill_fills_words_saved_before_the_fix(conn):
    """Simulates rows written by the old code path."""
    for word in ("findings", "police", "reticent"):
        conn.execute(
            "INSERT INTO vocab_words (id, user_id, word, lemma, pos, cefr, definition, created_at) "
            "VALUES (?, 'u1', ?, ?, 'noun', NULL, 'd', ?)",
            (uuid7(), word, cefr_lexicon.normalise(word), iso8601_utc_now()),
        )
    conn.commit()

    assert vocabulary.backfill_missing_cefr(conn) == 3
    levels = {
        r["word"]: r["cefr"] for r in conn.execute("SELECT word, cefr FROM vocab_words").fetchall()
    }
    assert levels == {"findings": "B1", "police": "A2", "reticent": "C1"}


def test_backfill_never_overwrites_a_level_already_there(conn):
    conn.execute(
        "INSERT INTO vocab_words (id, user_id, word, lemma, pos, cefr, definition, created_at) "
        "VALUES ('w1', 'u1', 'findings', 'findings', 'noun', 'C2', 'd', ?)",
        (iso8601_utc_now(),),
    )
    conn.commit()
    assert vocabulary.backfill_missing_cefr(conn) == 0
    assert conn.execute("SELECT cefr FROM vocab_words WHERE id = 'w1'").fetchone()["cefr"] == "C2"


def test_backfill_leaves_genuinely_unknown_words_alone(conn):
    conn.execute(
        "INSERT INTO vocab_words (id, user_id, word, lemma, pos, cefr, definition, created_at) "
        "VALUES ('w2', 'u1', 'anecdote', 'anecdote', 'noun', NULL, 'd', ?)",
        (iso8601_utc_now(),),
    )
    conn.commit()
    assert vocabulary.backfill_missing_cefr(conn) == 0
    assert conn.execute("SELECT cefr FROM vocab_words WHERE id = 'w2'").fetchone()["cefr"] is None
