"""FSRS scheduling — the algorithm behind every due date in this app.

FSRS (Free Spaced Repetition Scheduler) v4.5, implemented directly rather
than taken from the `fsrs` package the spec names (§5.5). Two reasons, and
the second is the deciding one:

- Nothing else in the backend needs it, and it is ~100 lines of published
  arithmetic with no dependencies of its own.
- The app launches its backend with `uv run`, which re-syncs from
  pyproject.toml on every start. A dependency that cannot be fetched
  therefore does not degrade the scheduler — it stops the whole app from
  starting. This machine reaches PyPI over IPv4 only (IPv6 resolves and then
  black-holes), which has already cost one broken launch.

The parameters below are the published FSRS-4.5 defaults, trained on ~700M
reviews. They are deliberately not tuned here: per-user optimisation needs a
few thousand of that user's own reviews before it beats the defaults, and
this app has none yet.

Two numbers describe a card:

  stability  — days until recall probability falls to 90%. Grows with
               successful reviews, collapses on a lapse.
  difficulty — 1-10, how much work each review does for this card. Rises
               when you forget, falls slightly when a card is easy.
"""

import math
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Literal

# Rating, matching FSRS and the four buttons in the UI.
AGAIN, HARD, GOOD, EASY = 1, 2, 3, 4
Rating = Literal[1, 2, 3, 4]
RATING_NAMES: dict[int, str] = {AGAIN: "again", HARD: "hard", GOOD: "good", EASY: "easy"}

CardState = Literal["new", "learning", "review", "relearning"]

# Published FSRS-4.5 defaults.
DEFAULT_W: tuple[float, ...] = (
    0.4872, 1.4003, 3.7145, 13.8206, 5.1618, 1.2298, 0.8975, 0.0310,
    1.6474, 0.1367, 1.0461, 2.1072, 0.0793, 0.3246, 1.5870, 0.2272, 2.8755,
)

# The forgetting curve's shape. Fixed by the algorithm, not tunable.
_DECAY = -0.5
_FACTOR = 19 / 81

# Cards below this stay in sub-day steps rather than being given a date.
_LEARNING_STEP_MINUTES = 10
# A card is never scheduled further out than this (100 years).
_MAX_INTERVAL_DAYS = 36500
# Lapse count at which a card is treated as a leech (spec §5.5).
LEECH_THRESHOLD = 8


@dataclass(frozen=True)
class Card:
    """A card's scheduling state. `due` and `last_review` are UTC."""

    stability: float = 0.0
    difficulty: float = 0.0
    due: datetime | None = None
    last_review: datetime | None = None
    reps: int = 0
    lapses: int = 0
    state: CardState = "new"


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def retrievability(stability: float, elapsed_days: float) -> float:
    """Probability of recalling the card right now, 0-1.

    This is the forgetting curve, and it is what makes FSRS adaptive: the
    same rating means different things depending on whether it came at the
    right moment or long after the card was forgotten."""
    if stability <= 0:
        return 0.0
    return (1 + _FACTOR * max(0.0, elapsed_days) / stability) ** _DECAY


def interval_for(stability: float, target_retention: float) -> float:
    """Days until recall probability decays to `target_retention`."""
    retention = _clamp(target_retention, 0.7, 0.99)
    return (stability / _FACTOR) * (retention ** (1 / _DECAY) - 1)


def _initial_difficulty(w: tuple[float, ...], rating: int) -> float:
    return _clamp(w[4] - math.exp(w[5] * (rating - 1)) + 1, 1.0, 10.0)


def _next_difficulty(w: tuple[float, ...], difficulty: float, rating: int) -> float:
    # Linear damping by rating, then mean reversion toward the difficulty an
    # "easy" first answer would have produced — without that second term
    # difficulty only ever ratchets upward over a card's life.
    delta = difficulty - w[6] * (rating - 3)
    reverted = w[7] * _initial_difficulty(w, EASY) + (1 - w[7]) * delta
    return _clamp(reverted, 1.0, 10.0)


def _stability_after_recall(
    w: tuple[float, ...], difficulty: float, stability: float, r: float, rating: int
) -> float:
    hard_penalty = w[15] if rating == HARD else 1.0
    easy_bonus = w[16] if rating == EASY else 1.0
    growth = (
        math.exp(w[8])
        * (11 - difficulty)
        * (stability ** -w[9])
        * (math.exp(w[10] * (1 - r)) - 1)
        * hard_penalty
        * easy_bonus
    )
    return stability * (1 + growth)


def _stability_after_lapse(
    w: tuple[float, ...], difficulty: float, stability: float, r: float
) -> float:
    lapsed = (
        w[11]
        * (difficulty ** -w[12])
        * (((stability + 1) ** w[13]) - 1)
        * math.exp(w[14] * (1 - r))
    )
    # Forgetting must never *raise* stability, which the formula alone can do
    # for a card lapsed very early in its life.
    return min(lapsed, stability)


def review(
    card: Card,
    rating: int,
    *,
    now: datetime,
    target_retention: float = 0.9,
    w: tuple[float, ...] = DEFAULT_W,
) -> Card:
    """The scheduler. Returns the card's new state after one rating.

    Pure: no clock of its own, no database, no randomness — `now` is passed
    in so a whole review history can be replayed deterministically in a test.
    """
    if rating not in (AGAIN, HARD, GOOD, EASY):
        raise ValueError(f"rating must be 1-4, got {rating!r}")

    elapsed = 0.0
    if card.last_review is not None:
        elapsed = max(0.0, (now - card.last_review).total_seconds() / 86400)

    # `stability <= 0` alongside a non-new state is an inconsistent card: it
    # claims to have been reviewed but records no memory strength. Growth is
    # multiplicative here (stability ** -w[9]), so zero is not merely wrong, it
    # raises ZeroDivisionError and takes the scheduler down. There is nothing
    # to grow from, so it is treated as the first review it evidently is.
    if card.state == "new" or card.stability <= 0:
        stability = max(w[rating - 1], 0.01)
        difficulty = _initial_difficulty(w, rating)
    else:
        r = retrievability(card.stability, elapsed)
        difficulty = _next_difficulty(w, card.difficulty, rating)
        stability = (
            _stability_after_lapse(w, card.difficulty, card.stability, r)
            if rating == AGAIN
            else _stability_after_recall(w, card.difficulty, card.stability, r, rating)
        )
        stability = max(stability, 0.01)

    lapses = card.lapses + (1 if rating == AGAIN and card.state == "review" else 0)

    if rating == AGAIN:
        # Straight back into short steps. A forgotten card is worth minutes,
        # not days, however stable it used to be.
        state: CardState = "relearning" if card.state in ("review", "relearning") else "learning"
        due = now + timedelta(minutes=_LEARNING_STEP_MINUTES)
    elif card.state in ("new", "learning", "relearning") and rating == HARD:
        # Not yet convincing enough to graduate, but not a failure either.
        state = card.state if card.state != "new" else "learning"
        due = now + timedelta(minutes=_LEARNING_STEP_MINUTES)
    else:
        state = "review"
        days = _clamp(round(interval_for(stability, target_retention)), 1, _MAX_INTERVAL_DAYS)
        due = now + timedelta(days=days)

    return Card(
        stability=stability,
        difficulty=difficulty,
        due=due,
        last_review=now,
        reps=card.reps + 1,
        lapses=lapses,
        state=state,
    )


def preview(
    card: Card, *, now: datetime, target_retention: float = 0.9, w: tuple[float, ...] = DEFAULT_W
) -> dict[int, timedelta]:
    """What each of the four buttons would schedule, without committing.

    The UI shows these on the rating buttons so the learner can see that
    "Good" means six weeks and "Again" means ten minutes — a scheduler whose
    consequences are invisible is one nobody calibrates against."""
    out: dict[int, timedelta] = {}
    for rating in (AGAIN, HARD, GOOD, EASY):
        nxt = review(card, rating, now=now, target_retention=target_retention, w=w)
        out[rating] = (nxt.due - now) if nxt.due else timedelta(0)
    return out


def is_leech(card: Card) -> bool:
    """Spec §5.5: eight lapses means the card is not working as posed."""
    return card.lapses >= LEECH_THRESHOLD


def utcnow() -> datetime:
    return datetime.now(timezone.utc)
