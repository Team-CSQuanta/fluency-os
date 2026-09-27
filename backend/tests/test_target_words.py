"""Which saved words a conversation asks the learner to use."""

import json
from datetime import datetime, timedelta, timezone

from app.services import conversation, review, scenarios, target_words
from app.services.fsrs import GOOD
from tests.test_conversation import _fresh_conn, _make_user, _save_word, fake_llm  # noqa: F401

NOW = datetime(2026, 6, 1, tzinfo=timezone.utc)
FREE = scenarios.BY_KEY["free"]


def _band(conn, wid, band):
    conn.execute("UPDATE vocab_words SET cefr = ? WHERE id = ?", (band, wid))


def _said(conn, user_id, wid, outcome="spontaneous", at="2026-05-01T00:00:00Z"):
    conn.execute(
        "INSERT INTO review_logs (id, user_id, vocab_word_id, session_id, source, outcome, created_at) "
        "VALUES (?, ?, ?, NULL, 'conversation', ?, ?)",
        (f"log-{wid}-{outcome}-{at}", user_id, wid, outcome, at),
    )


def _picked(conn, user_id, scene=FREE, level="B1"):
    return [p.row["word"] for p in target_words.select(conn, user_id, scene, level, now=NOW)]


def test_a_flashcard_review_is_not_the_same_as_saying_the_word(tmp_path):
    """Flashcard answers share review_logs with conversation outcomes, and the
    old count treated both as use — so reviewing a card pushed the word out of
    conversation, the one place it could go past mastery level 2."""
    conn = _fresh_conn(tmp_path)
    user_id = _make_user(conn)
    carded = _save_word(conn, user_id, "reticent")
    spoken = _save_word(conn, user_id, "stark")
    for wid in (carded, spoken):
        _band(conn, wid, "B2")
        review.answer_card(conn, user_id, wid, GOOD, now=NOW - timedelta(hours=1))
    _said(conn, user_id, spoken)
    assert _picked(conn, user_id)[0] == "reticent"


def test_suspended_words_and_words_with_nothing_to_define_them_are_left_out(tmp_path):
    conn = _fresh_conn(tmp_path)
    user_id = _make_user(conn)
    kept = _save_word(conn, user_id, "reticent")
    suspended = _save_word(conn, user_id, "stark")
    _save_word(conn, user_id, "blank", definition="(no definition yet — blank)")
    review.set_suspended(conn, user_id, suspended, True)
    assert _picked(conn, user_id) == ["reticent"]
    assert kept


def test_words_below_the_learners_level_step_back(tmp_path):
    conn = _fresh_conn(tmp_path)
    user_id = _make_user(conn)
    _band(conn, _save_word(conn, user_id, "several"), "A1")
    _band(conn, _save_word(conn, user_id, "reluctant"), "B1")
    assert _picked(conn, user_id, level="B1") == ["reluctant", "several"]


def test_a_word_due_for_review_comes_before_a_new_one(tmp_path):
    conn = _fresh_conn(tmp_path)
    user_id = _make_user(conn)
    due = _save_word(conn, user_id, "reticent")
    _save_word(conn, user_id, "stark")
    review.answer_card(conn, user_id, due, GOOD, now=NOW - timedelta(days=60))
    picks = target_words.select(conn, user_id, FREE, "B1", now=NOW)
    assert picks[0].row["word"] == "reticent"
    assert "due" in picks[0].reason


def test_words_that_belong_in_the_scene_are_preferred(tmp_path):
    conn = _fresh_conn(tmp_path)
    user_id = _make_user(conn)
    _band(conn, _save_word(conn, user_id, "keyboard", definition="a set of keys for typing"), "B1")
    _band(conn, _save_word(conn, user_id, "latte", definition="a coffee drink made with hot milk"), "B1")
    picks = target_words.select(conn, user_id, scenarios.BY_KEY["coffee"], "B1", now=NOW)
    assert picks[0].row["word"] == "latte"
    assert "fits scene" in picks[0].reason


def test_a_word_used_wrongly_comes_back_first(tmp_path):
    conn = _fresh_conn(tmp_path)
    user_id = _make_user(conn)
    _save_word(conn, user_id, "stark")
    wrong = _save_word(conn, user_id, "reticent")
    _said(conn, user_id, wrong, "incorrect")
    picks = target_words.select(conn, user_id, FREE, "B1", now=NOW)
    assert picks[0].row["word"] == "reticent" and picks[0].reason.startswith("retry")


def test_a_mastered_word_steps_back():
    level = "B1"
    base = dict(band="B1", is_new=False, overdue_days=0.0, last_outcome="spontaneous", fit=0, just_targeted=False)
    mastered, _ = target_words.score(target_words.Candidate(word="a", mastery=5, produced=3, **base), level)
    growing, _ = target_words.score(target_words.Candidate(word="b", mastery=3, produced=1, **base), level)
    assert mastered < growing


def test_a_session_keeps_why_each_word_was_picked(tmp_path, fake_llm):
    conn = _fresh_conn(tmp_path)
    user_id = _make_user(conn)
    _save_word(conn, user_id, "latte", definition="a coffee drink made with hot milk")
    session_id = conversation.start_session(conn, user_id=user_id, scenario="coffee", channel="text")
    session = conversation.get_session_row(conn, session_id, user_id)
    (wid,) = json.loads(session["target_word_ids"])
    assert "fits scene" in conversation.target_reasons(session)[wid]
    assert conversation.session_persona(session).name == "Maya"
