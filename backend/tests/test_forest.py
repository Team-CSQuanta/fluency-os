"""Spec §8 — the Forest.

The property under test throughout: a tree is a *drawing* of an FSRS card, not
a record beside one. Nothing here can be grown except by the scheduler.
"""

import sqlite3

import pytest

from app.db import get_connection
from app.migrations.runner import run_migrations
from app.services import forest
from app.utils.ids import uuid7
from app.utils.time import iso8601_utc_ago, iso8601_utc_now


@pytest.fixture()
def conn(tmp_path) -> sqlite3.Connection:
    c = get_connection(str(tmp_path / "forest.db"))
    run_migrations(c)
    c.execute(
        "INSERT INTO users (id, display_name, native_language, target_language, cefr_level, created_at) "
        "VALUES ('u1','L','bn','en','B1',?)",
        (iso8601_utc_now(),),
    )
    c.commit()
    yield c
    c.close()


def _word(conn, word, *, stability=0.0, state="new", lapses=0, due=None, suspended=0, kind=None):
    wid = uuid7()
    conn.execute(
        "INSERT INTO vocab_words (id, user_id, word, lemma, pos, definition, created_at) "
        "VALUES (?, 'u1', ?, ?, 'noun', 'd', ?)",
        (wid, word, word, iso8601_utc_now()),
    )
    conn.execute(
        "INSERT INTO review_cards (vocab_word_id, user_id, state, stability, difficulty, reps, "
        "lapses, suspended, due, created_at) VALUES (?, 'u1', ?, ?, 5.0, 1, ?, ?, ?, ?)",
        (wid, state, stability, lapses, suspended, due, iso8601_utc_now()),
    )
    if kind:
        conn.execute(
            "INSERT INTO vocab_contexts (id, vocab_word_id, kind, snippet, source_label, created_at) "
            "VALUES (?, ?, ?, 's', 'l', ?)",
            (uuid7(), wid, kind, iso8601_utc_now()),
        )
    conn.commit()
    return wid


def _log(conn, wid, outcome, source="flashcard"):
    conn.execute(
        "INSERT INTO review_logs (id, user_id, vocab_word_id, source, outcome, created_at) "
        "VALUES (?, 'u1', ?, ?, ?, ?)",
        (uuid7(), wid, source, outcome, iso8601_utc_now()),
    )
    conn.commit()


# ---------------------------------------------------------------------------
# Growth is the scheduler's, not the forest's
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "stability,state,expected",
    [
        (None, "new", 0),      # Seed
        (0.5, "learning", 0),
        (2.0, "review", 1),    # Sprout
        (5.0, "review", 2),    # Seedling
        (14.0, "review", 3),   # Sapling
        (40.0, "review", 4),   # Young tree
        (400.0, "review", 5),  # Ancient
    ],
)
def test_a_tree_is_the_size_of_its_memory(stability, state, expected):
    """Stage is a band of FSRS stability and nothing else. There is no way to
    grow a tree except to remember the word for longer."""
    assert forest.stage_for(stability, state) == expected


def test_a_new_card_is_a_seed_however_much_stability_it_claims():
    """A card in the `new` state has not been recalled once; whatever number is
    sitting in its stability column, it has earned nothing."""
    assert forest.stage_for(99.0, "new") == 0


def test_scars_and_wilt_are_measured_separately():
    """A word forgotten three times and relearned is not in trouble NOW; a word
    never forgotten but three weeks overdue is. One number mixing them would
    say the same about both."""
    healed = forest.health_for(lapses=3, overdue_days=0)
    neglected = forest.health_for(lapses=0, overdue_days=21)
    assert healed > neglected
    assert forest.health_for(lapses=0, overdue_days=0) == 100


def test_health_bottoms_out_rather_than_going_negative():
    assert forest.health_for(lapses=99, overdue_days=99) == 0


# ---------------------------------------------------------------------------
# Where a word was met is the ground it grows on
# ---------------------------------------------------------------------------


def test_a_word_caught_while_watching_grows_in_the_cinema_clearing(conn):
    _word(conn, "reticent", kind="clip")
    assert forest.trees(conn, "u1")[0].biome == "cinema"


def test_a_word_first_produced_aloud_belongs_by_the_river(conn):
    """Spoken before it was ever filed. Whatever page it later turns up on, the
    learner met it in conversation."""
    wid = _word(conn, "candid", kind="page")
    _log(conn, wid, "spontaneous", source="conversation")
    assert forest.trees(conn, "u1")[0].biome == "river"


def test_a_word_saved_by_hand_grows_in_the_meadow(conn):
    _word(conn, "stark")
    assert forest.trees(conn, "u1")[0].biome == "meadow"


def test_a_long_overdue_tree_goes_dormant(conn):
    _word(conn, "wary", stability=10, state="review", due=iso8601_utc_ago(days=45))
    assert forest.trees(conn, "u1")[0].dormant is True


def test_a_tree_reviewed_on_time_is_not_dormant(conn):
    _word(conn, "wary", stability=10, state="review", due=iso8601_utc_now())
    assert forest.trees(conn, "u1")[0].dormant is False


# ---------------------------------------------------------------------------
# Focus sessions
# ---------------------------------------------------------------------------
#
# The forest used to run a currency: sunlight, earned per review outcome and
# per focus minute, spent on a streak freeze and on reviving a dormant tree.
# It is gone. The freeze was the reason — it could be bought, it was counted,
# and nothing in the streak ever consulted it, so the streak it promised to
# protect broke anyway. What is left rewards nothing and records what
# happened, which is all the forest was ever able to honour.


def test_a_session_is_not_done_until_it_is_sat_through(conn):
    """A timer completed on a button press is a button, not a commitment."""
    row = forest.start_focus(conn, user_id="u1", minutes=25)
    with pytest.raises(ValueError, match="minutes left"):
        forest.complete_focus(conn, session_id=row["id"], user_id="u1")
    fresh = conn.execute(
        "SELECT completed_at FROM forest_focus_sessions WHERE id = ?", (row["id"],)
    ).fetchone()
    assert fresh["completed_at"] is None


def test_a_session_sat_through_is_marked_done_and_stays_done(conn):
    row = forest.start_focus(conn, user_id="u1", minutes=25)
    conn.execute(
        "UPDATE forest_focus_sessions SET started_at = ? WHERE id = ?",
        (iso8601_utc_ago(days=1), row["id"]),
    )
    done = forest.complete_focus(conn, session_id=row["id"], user_id="u1")
    assert done["completed_at"] is not None
    assert done["minutes"] == 25
    # Completing again is a no-op rather than a second record.
    again = forest.complete_focus(conn, session_id=row["id"], user_id="u1")
    assert again["completed_at"] == done["completed_at"]


def test_the_forest_offers_nothing_to_buy(conn):
    """The currency is gone from the payload as well as from the screen."""
    summary = forest.summary(conn, "u1")
    assert "sunlight" not in summary
    assert "costs" not in summary
    assert not hasattr(forest, "spend")
    assert not hasattr(forest, "sunlight_earned")


def test_an_absurd_session_length_is_refused(conn):
    with pytest.raises(ValueError):
        forest.start_focus(conn, user_id="u1", minutes=0)
    with pytest.raises(ValueError):
        forest.start_focus(conn, user_id="u1", minutes=999)


def test_the_summary_counts_every_tree_exactly_once(conn):
    _word(conn, "a", kind="clip")
    _word(conn, "b", kind="page")
    _word(conn, "c")
    data = forest.summary(conn, "u1")
    assert len(data["trees"]) == 3
    assert sum(data["biomes"].values()) == 3
    assert sum(data["stages"]) == 3
