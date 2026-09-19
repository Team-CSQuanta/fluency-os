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
# Sunlight
# ---------------------------------------------------------------------------


def test_sunlight_is_earned_from_work_already_recorded(conn):
    """Derived from review_logs rather than banked in a ledger of its own: a
    currency must never disagree with the work that produced it."""
    wid = _word(conn, "mitigate")
    _log(conn, wid, "spontaneous", source="conversation")
    _log(conn, wid, "again")
    expected = forest.SUNLIGHT_PER_OUTCOME["spontaneous"] + forest.SUNLIGHT_PER_OUTCOME["again"]
    assert forest.sunlight_earned(conn, "u1") == expected


def test_producing_a_word_unprompted_is_worth_more_than_recognising_it(conn):
    """The hardest thing on the list, and the only one that cannot happen by
    accident."""
    assert forest.SUNLIGHT_PER_OUTCOME["spontaneous"] > forest.SUNLIGHT_PER_OUTCOME["good"]
    assert forest.SUNLIGHT_PER_OUTCOME["avoided"] == 0


def test_spending_more_than_you_have_is_refused(conn):
    with pytest.raises(ValueError, match="sunlight"):
        forest.spend(conn, user_id="u1", kind="streak_freeze")


def test_a_spend_comes_off_the_balance(conn):
    wid = _word(conn, "throttle")
    for _ in range(30):
        _log(conn, wid, "spontaneous", source="conversation")
    before = forest.sunlight_balance(conn, "u1")
    result = forest.spend(conn, user_id="u1", kind="revive", vocab_word_id=wid)
    assert result["balance"] == before - forest.COSTS["revive"]
    assert forest.sunlight_balance(conn, "u1") == before - forest.COSTS["revive"]


def test_reviving_a_tree_wakes_it_rather_than_healing_it(conn):
    """It comes back asking to be reviewed, not quietly restored — the point is
    to meet the word again, not to buy the appearance of knowing it."""
    wid = _word(conn, "opaque", stability=5, state="review",
                due=iso8601_utc_ago(days=60), suspended=1)
    for _ in range(20):
        _log(conn, wid, "spontaneous", source="conversation")
    assert forest.trees(conn, "u1")[0].dormant is True

    forest.spend(conn, user_id="u1", kind="revive", vocab_word_id=wid)
    tree = forest.trees(conn, "u1")[0]
    assert tree.dormant is False
    # Woken, not grown: stability is untouched, so the tree is the same size.
    assert tree.stability == 5.0


# ---------------------------------------------------------------------------
# Focus sessions
# ---------------------------------------------------------------------------


def test_a_focus_session_pays_nothing_until_it_is_sat_through(conn):
    """A timer that pays out on a button press is a button that prints
    sunlight."""
    row = forest.start_focus(conn, user_id="u1", minutes=25)
    with pytest.raises(ValueError, match="minutes left"):
        forest.complete_focus(conn, session_id=row["id"], user_id="u1")
    assert forest.sunlight_earned(conn, "u1") == 0


def test_a_completed_session_pays_out_once(conn):
    row = forest.start_focus(conn, user_id="u1", minutes=25)
    conn.execute(
        "UPDATE forest_focus_sessions SET started_at = ? WHERE id = ?",
        (iso8601_utc_ago(days=1), row["id"]),
    )
    done = forest.complete_focus(conn, session_id=row["id"], user_id="u1")
    assert done["sunlight"] == 25 * forest.SUNLIGHT_PER_FOCUS_MINUTE
    # Completing again is a no-op rather than a second payout.
    again = forest.complete_focus(conn, session_id=row["id"], user_id="u1")
    assert again["sunlight"] == done["sunlight"]
    assert forest.sunlight_earned(conn, "u1") == done["sunlight"]


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
