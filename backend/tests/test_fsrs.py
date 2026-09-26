"""The scheduler. Every due date in the app comes from here, and a scheduler
that is subtly wrong is worse than none: it silently wastes the learner's
time on cards they know and drops the ones they don't.

These assert the *properties* FSRS must have rather than exact intervals —
the constants are the published FSRS-4.5 defaults, and pinning arithmetic to
three decimal places would only make the tests break when they are retuned.
"""

from datetime import datetime, timedelta, timezone

import pytest

from app.services import fsrs
from app.services.fsrs import AGAIN, EASY, GOOD, HARD, Card

T0 = datetime(2026, 1, 1, tzinfo=timezone.utc)


def _answer(card: Card, rating: int, *, at: datetime) -> Card:
    return fsrs.review(card, rating, now=at)


def test_a_new_card_gets_state_from_its_first_answer():
    for rating in (AGAIN, HARD, GOOD, EASY):
        card = _answer(Card(), rating, at=T0)
        assert card.reps == 1
        assert card.stability > 0
        assert 1.0 <= card.difficulty <= 10.0
        assert card.due is not None and card.due > T0


def test_better_answers_schedule_further_out():
    """The core promise of any scheduler: the buttons have to mean
    something, and mean it in the right order."""
    gaps = []
    for rating in (AGAIN, HARD, GOOD, EASY):
        card = _answer(Card(), rating, at=T0)
        gaps.append((card.due - T0).total_seconds())
    assert gaps == sorted(gaps), f"intervals not monotonic in rating: {gaps}"
    assert gaps[0] < gaps[-1]


def test_an_easy_first_answer_is_easier_than_a_hard_one():
    assert _answer(Card(), EASY, at=T0).difficulty < _answer(Card(), AGAIN, at=T0).difficulty


def test_repeated_good_answers_grow_the_interval():
    """Stability must compound, or a well-known card keeps coming back
    forever and the queue never drains."""
    card = _answer(Card(), GOOD, at=T0)
    now = T0
    intervals = []
    for _ in range(6):
        now = card.due
        prev = card.stability
        card = _answer(card, GOOD, at=now)
        assert card.stability > prev, "a correct answer must never reduce stability"
        intervals.append((card.due - now).days)
    assert intervals == sorted(intervals), f"intervals should not shrink: {intervals}"
    assert intervals[-1] > intervals[0]


def test_forgetting_collapses_the_interval_and_counts_a_lapse():
    card = _answer(Card(), GOOD, at=T0)
    for _ in range(4):
        card = _answer(card, GOOD, at=card.due)
    mature = card
    assert mature.state == "review"
    assert (mature.due - mature.last_review).days > 7

    lapsed = _answer(mature, AGAIN, at=mature.due)
    assert lapsed.lapses == mature.lapses + 1
    assert lapsed.state == "relearning"
    assert lapsed.stability <= mature.stability, "forgetting must not raise stability"
    assert (lapsed.due - mature.due) < timedelta(hours=1), "a forgotten card is worth minutes"


def test_forgetting_makes_a_card_harder():
    card = _answer(Card(), GOOD, at=T0)
    card = _answer(card, GOOD, at=card.due)
    assert _answer(card, AGAIN, at=card.due).difficulty > card.difficulty


def test_difficulty_stays_in_range_under_abuse():
    """Mean reversion is what stops difficulty ratcheting to one end and
    sticking there; without it a long run of one rating pins the card."""
    for rating in (AGAIN, EASY):
        card = Card()
        now = T0
        for _ in range(60):
            card = _answer(card, rating, at=now)
            now = card.due
            assert 1.0 <= card.difficulty <= 10.0


def test_answering_late_is_worth_more_than_answering_early():
    """Recalling a card you were about to forget proves more than recalling
    one reviewed an hour ago — the forgetting curve is the whole point."""
    card = _answer(Card(), GOOD, at=T0)
    card = _answer(card, GOOD, at=card.due)

    early = _answer(card, GOOD, at=card.last_review + timedelta(days=1))
    late = _answer(card, GOOD, at=card.due + timedelta(days=10))
    assert late.stability > early.stability


def test_retrievability_decays_from_one_toward_zero():
    assert fsrs.retrievability(10, 0) == pytest.approx(1.0)
    assert 0 < fsrs.retrievability(10, 10) < 1
    assert fsrs.retrievability(10, 10) > fsrs.retrievability(10, 100)
    # A card with no history is not "remembered".
    assert fsrs.retrievability(0, 5) == 0.0


def test_interval_honours_target_retention():
    """A learner who wants to remember more must be shown cards sooner."""
    assert fsrs.interval_for(100, 0.95) < fsrs.interval_for(100, 0.80)


def test_intervals_are_whole_days_and_never_zero():
    card = _answer(Card(), EASY, at=T0)
    for _ in range(20):
        gap = card.due - card.last_review
        if card.state == "review":
            assert gap >= timedelta(days=1), "a review card must never be due the same day"
        card = _answer(card, GOOD, at=card.due)


def test_preview_matches_what_rating_actually_does():
    """The buttons promise an interval; the scheduler must keep it."""
    card = _answer(Card(), GOOD, at=T0)
    now = card.due
    previews = fsrs.preview(card, now=now)
    for rating, promised in previews.items():
        actual = _answer(card, rating, at=now).due - now
        assert actual == promised


def test_leeches_are_flagged_at_the_spec_threshold():
    assert not fsrs.is_leech(Card(lapses=7))
    assert fsrs.is_leech(Card(lapses=8))


def test_an_invalid_rating_is_refused():
    for bad in (0, 5, -1):
        with pytest.raises(ValueError):
            fsrs.review(Card(), bad, now=T0)


def test_a_card_claiming_review_state_with_no_stability_does_not_crash_the_scheduler():
    """Growth is multiplicative in stability, so zero raises ZeroDivisionError
    rather than merely giving a wrong answer. Such a row records no memory
    strength at all, so it is scheduled as the first review it evidently is."""
    from app.services import fsrs

    broken = fsrs.Card(
        stability=0.0, difficulty=0.0, state="review", due=None, last_review=None, reps=1, lapses=0
    )
    now = fsrs.utcnow()
    for rating in (fsrs.AGAIN, fsrs.HARD, fsrs.GOOD, fsrs.EASY):
        after = fsrs.review(broken, rating, now=now)
        assert after.stability > 0
        assert 1.0 <= after.difficulty <= 10.0
