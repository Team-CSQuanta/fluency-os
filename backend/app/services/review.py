"""The review queue, and the two things that can schedule a card.

Spec §5.5 and §6.3. The second is the project's actual thesis: a word is not
learned because it was recognised on a flashcard, but because it was produced
unprompted in conversation. Both paths land in the same `review_logs` table
and move the same FSRS state — that is what "dual-source review" means, and
it is why `conversation_outcome_to_rating` below is the most load-bearing
dictionary in the codebase.
"""

import json
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from app.services import fsrs
from app.services.fsrs import AGAIN, EASY, GOOD, HARD, Card
from app.utils.ids import uuid7
from app.utils.time import iso8601_utc_now

# Spec §6.3. A conversation outcome is a review, and this is its rating.
#
#   spontaneous — used correctly with no prompt      -> Easy
#   prompted    — used correctly only after a hint   -> Good
#   incorrect   — attempted with the wrong sense     -> Again
#   avoided     — never attempted                    -> Hard
#
# "avoided" is Hard rather than Again deliberately: not reaching for a word is
# weaker evidence than reaching for it and getting it wrong. Again would dump
# the card into relearning on evidence that the learner may simply not have
# had an opening to use it.
CONVERSATION_RATINGS: dict[str, int] = {
    "spontaneous": EASY,
    "prompted": GOOD,
    "incorrect": AGAIN,
    "avoided": HARD,
}

# How many cards one sitting offers. Spec §5.5 asks for load smoothing; this
# is the blunt half of it — a backlog is worked through at a steady rate
# instead of presenting four hundred cards and guaranteeing avoidance.
DEFAULT_SESSION_LIMIT = 20
# Of that, at most this many cards the learner has never seen. New cards are
# the ones that create tomorrow's workload, so they are the ones to cap.
DEFAULT_NEW_PER_SESSION = 5

CARD_TYPES = ("recognition", "production", "cloze", "listening")


@dataclass(frozen=True)
class Mastery:
    level: int
    label: str
    reason: str


MASTERY_LABELS = ("unseen", "sprout", "seedling", "growing", "strong", "mastered")


def _parse(ts: str | None) -> datetime | None:
    if not ts:
        return None
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


def _fmt(dt: datetime | None) -> str | None:
    return None if dt is None else dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def card_from_row(row: sqlite3.Row) -> Card:
    return Card(
        stability=row["stability"],
        difficulty=row["difficulty"],
        due=_parse(row["due"]),
        last_review=_parse(row["last_review"]),
        reps=row["reps"],
        lapses=row["lapses"],
        state=row["state"],
    )


def target_retention(conn: sqlite3.Connection, user_id: str) -> float:
    row = conn.execute(
        "SELECT target_retention_srs FROM user_settings WHERE user_id = ?", (user_id,)
    ).fetchone()
    value = row["target_retention_srs"] if row and row["target_retention_srs"] else 0.9
    return max(0.7, min(0.99, float(value)))


def ensure_card(conn: sqlite3.Connection, user_id: str, vocab_word_id: str) -> sqlite3.Row:
    """Every saved word has a card. Created here rather than only by the
    migration so a word saved after this feature shipped is schedulable the
    moment it exists, without a separate "add to review" step."""
    conn.execute(
        "INSERT OR IGNORE INTO review_cards (vocab_word_id, user_id, created_at) VALUES (?, ?, ?)",
        (vocab_word_id, user_id, iso8601_utc_now()),
    )
    return conn.execute(
        "SELECT * FROM review_cards WHERE vocab_word_id = ?", (vocab_word_id,)
    ).fetchone()


# --- mastery ----------------------------------------------------------------


def spontaneous_sessions(conn: sqlite3.Connection, vocab_word_id: str) -> int:
    """Distinct conversations in which this word was produced unprompted.

    Distinct sessions, not distinct logs: saying a word three times in one
    conversation is one piece of evidence about recall, not three. Spec §6.3
    is explicit that mastery needs three *sessions*."""
    return conn.execute(
        """
        SELECT COUNT(DISTINCT COALESCE(session_id, id)) AS n FROM review_logs
        WHERE vocab_word_id = ? AND source = 'conversation' AND outcome = 'spontaneous'
        """,
        (vocab_word_id,),
    ).fetchone()["n"]


def mastery_for(card: Card, spontaneous_session_count: int) -> Mastery:
    """Spec §6.3 and §8's growth stages, in one place.

    The ceiling is the point: levels 3 and up are unreachable through
    flashcards alone, however stable the card becomes. "A card can only reach
    mastery level 5 if it has at least three spontaneous events across
    different sessions — recognition alone can never mark a word mastered.
    This rule is the formal expression of the project's thesis."
    """
    if card.reps == 0:
        return Mastery(0, MASTERY_LABELS[0], "not reviewed yet")
    if card.stability < 7:
        return Mastery(1, MASTERY_LABELS[1], "reviewed, still settling")
    if spontaneous_session_count < 1:
        return Mastery(2, MASTERY_LABELS[2], "recognised reliably — use it in conversation to go further")
    if card.stability < 21 or spontaneous_session_count < 2:
        return Mastery(3, MASTERY_LABELS[3], "used unprompted once")
    if card.stability < 60 or spontaneous_session_count < 3:
        return Mastery(4, MASTERY_LABELS[4], "used unprompted in two conversations")
    return Mastery(5, MASTERY_LABELS[5], "used unprompted in three separate conversations")


# --- the queue --------------------------------------------------------------


def _card_type_for(word: sqlite3.Row, context: sqlite3.Row | None, position: int) -> str:
    """Interleaved by position (spec §5.5), but never asking for something
    the data cannot support — a cloze needs a sentence with the word in it,
    and a listening card needs audio. Falling back to recognition is always
    possible because the word itself is always there."""
    wanted = CARD_TYPES[position % len(CARD_TYPES)]
    if wanted == "cloze" and not (context or word["example"]):
        wanted = "recognition"
    if wanted == "listening" and not word["audio_url"]:
        wanted = "production" if word["definition"] else "recognition"
    if wanted == "production" and not word["definition"]:
        wanted = "recognition"
    return wanted


def _cloze(sentence: str, word: str) -> tuple[str, str] | None:
    """Splits a sentence around the target word. Returns None when the word
    isn't actually in it — a cloze whose blank hides nothing teaches nothing."""
    import re

    match = re.search(rf"\b{re.escape(word)}\w*\b", sentence, re.IGNORECASE)
    if not match:
        return None
    return sentence[: match.start()].strip(), sentence[match.end() :].strip()


def build_queue(
    conn: sqlite3.Connection,
    user_id: str,
    *,
    limit: int = DEFAULT_SESSION_LIMIT,
    new_limit: int = DEFAULT_NEW_PER_SESSION,
    now: datetime | None = None,
) -> list[dict]:
    """Due cards first, then a capped number of new ones.

    Due-first because an overdue card is actively being forgotten while a new
    one is merely unlearned; introducing new material ahead of rescuing old
    is how backlogs become permanent."""
    now = now or fsrs.utcnow()
    now_iso = _fmt(now)

    due = conn.execute(
        """
        SELECT rc.*, w.word, w.lemma, w.pos, w.cefr, w.definition, w.example,
               w.simpler, w.synonyms, w.ipa, w.audio_url, w.ai_mnemonic
        FROM review_cards rc JOIN vocab_words w ON w.id = rc.vocab_word_id
        WHERE rc.user_id = ? AND rc.suspended = 0 AND rc.state != 'new' AND rc.due <= ?
        ORDER BY rc.due ASC
        LIMIT ?
        """,
        (user_id, now_iso, limit),
    ).fetchall()

    remaining = max(0, limit - len(due))
    fresh = conn.execute(
        """
        SELECT rc.*, w.word, w.lemma, w.pos, w.cefr, w.definition, w.example,
               w.simpler, w.synonyms, w.ipa, w.audio_url, w.ai_mnemonic
        FROM review_cards rc JOIN vocab_words w ON w.id = rc.vocab_word_id
        WHERE rc.user_id = ? AND rc.suspended = 0 AND rc.state = 'new'
        ORDER BY w.created_at DESC
        LIMIT ?
        """,
        (user_id, min(remaining, new_limit)),
    ).fetchall()

    retention = target_retention(conn, user_id)
    out: list[dict] = []
    for position, row in enumerate([*due, *fresh]):
        out.append(_card_out(conn, row, position, retention, now))
    return out


def _card_out(
    conn: sqlite3.Connection, row: sqlite3.Row, position: int, retention: float, now: datetime
) -> dict:
    context = conn.execute(
        "SELECT snippet, source_label FROM vocab_contexts WHERE vocab_word_id = ? "
        "ORDER BY created_at DESC LIMIT 1",
        (row["vocab_word_id"],),
    ).fetchone()

    card = card_from_row(row)
    card_type = _card_type_for(row, context, position)

    sentence = (context["snippet"] if context else None) or row["example"]
    before = after = None
    if card_type == "cloze" and sentence:
        split = _cloze(sentence, row["word"])
        if split:
            before, after = split
        else:
            card_type = "recognition"

    previews = fsrs.preview(card, now=now, target_retention=retention)
    spont = spontaneous_sessions(conn, row["vocab_word_id"])
    mastery = mastery_for(card, spont)

    return {
        "vocab_word_id": row["vocab_word_id"],
        "card_type": card_type,
        "word": row["word"],
        "ipa": row["ipa"],
        "pos": row["pos"],
        "cefr": row["cefr"],
        "definition": row["definition"],
        "simpler": row["simpler"],
        "example": row["example"],
        "mnemonic": row["ai_mnemonic"],
        "synonyms": json.loads(row["synonyms"] or "[]"),
        "audio_url": row["audio_url"],
        "context_snippet": context["snippet"] if context else None,
        "context_source": context["source_label"] if context else None,
        "cloze_before": before,
        "cloze_after": after,
        "state": row["state"],
        "stability_days": round(card.stability, 1),
        "difficulty": round(card.difficulty, 1),
        "reps": card.reps,
        "lapses": card.lapses,
        "spontaneous_sessions": spont,
        "mastery_level": mastery.level,
        "mastery_label": mastery.label,
        "mastery_reason": mastery.reason,
        "is_leech": fsrs.is_leech(card),
        "intervals": {fsrs.RATING_NAMES[r]: _humanise(d) for r, d in previews.items()},
    }


def _humanise(delta: timedelta) -> str:
    """Interval labels for the rating buttons. A scheduler whose consequences
    are invisible is one nobody calibrates their answers against."""
    minutes = delta.total_seconds() / 60
    if minutes < 60:
        return f"{max(1, round(minutes))} m"
    if minutes < 60 * 24:
        return f"{round(minutes / 60)} h"
    days = minutes / (60 * 24)
    if days < 30:
        return f"{round(days)} d"
    if days < 365:
        return f"{days / 30:.1f} mo"
    return f"{days / 365:.1f} y"


# --- answering --------------------------------------------------------------


def _log(
    conn: sqlite3.Connection,
    *,
    user_id: str,
    vocab_word_id: str,
    source: str,
    outcome: str,
    rating: int | None,
    card: Card,
    elapsed_days: float | None,
    session_id: str | None = None,
) -> None:
    conn.execute(
        """
        INSERT INTO review_logs
          (id, user_id, vocab_word_id, session_id, source, outcome, rating,
           stability, difficulty, elapsed_days, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            uuid7(), user_id, vocab_word_id, session_id, source, outcome, rating,
            card.stability, card.difficulty, elapsed_days, iso8601_utc_now(),
        ),
    )


def _save(conn: sqlite3.Connection, vocab_word_id: str, card: Card, *, suspended: bool) -> None:
    conn.execute(
        """
        UPDATE review_cards
           SET stability = ?, difficulty = ?, state = ?, due = ?, last_review = ?,
               reps = ?, lapses = ?, suspended = ?
         WHERE vocab_word_id = ?
        """,
        (
            card.stability, card.difficulty, card.state, _fmt(card.due), _fmt(card.last_review),
            card.reps, card.lapses, 1 if suspended else 0, vocab_word_id,
        ),
    )


def _apply(
    conn: sqlite3.Connection,
    user_id: str,
    vocab_word_id: str,
    rating: int,
    *,
    source: str,
    outcome: str,
    session_id: str | None = None,
    now: datetime | None = None,
) -> dict:
    now = now or fsrs.utcnow()
    row = ensure_card(conn, user_id, vocab_word_id)
    before = card_from_row(row)
    elapsed = (
        (now - before.last_review).total_seconds() / 86400 if before.last_review else None
    )

    after = fsrs.review(before, rating, now=now, target_retention=target_retention(conn, user_id))
    # Spec §5.5: a card that keeps lapsing is not working as posed and should
    # leave the queue rather than keep consuming sittings. Its state is kept,
    # so unsuspending resumes the schedule instead of restarting it.
    suspended = bool(row["suspended"]) or fsrs.is_leech(after)

    _save(conn, vocab_word_id, after, suspended=suspended)
    _log(
        conn,
        user_id=user_id,
        vocab_word_id=vocab_word_id,
        source=source,
        outcome=outcome,
        rating=rating,
        card=after,
        elapsed_days=elapsed,
        session_id=session_id,
    )

    spont = spontaneous_sessions(conn, vocab_word_id)
    mastery = mastery_for(after, spont)
    return {
        "vocab_word_id": vocab_word_id,
        "state": after.state,
        "due": _fmt(after.due),
        "stability_days": round(after.stability, 1),
        "difficulty": round(after.difficulty, 1),
        "reps": after.reps,
        "lapses": after.lapses,
        "suspended": suspended,
        "is_leech": fsrs.is_leech(after),
        "mastery_level": mastery.level,
        "mastery_label": mastery.label,
        "mastery_reason": mastery.reason,
        "interval_label": _humanise((after.due - now) if after.due else timedelta(0)),
    }


def answer_card(
    conn: sqlite3.Connection, user_id: str, vocab_word_id: str, rating: int, *, now: datetime | None = None
) -> dict:
    """A flashcard answered with one of the four buttons."""
    if rating not in fsrs.RATING_NAMES:
        raise ValueError(f"rating must be 1-4, got {rating!r}")
    owns = conn.execute(
        "SELECT 1 FROM vocab_words WHERE id = ? AND user_id = ?", (vocab_word_id, user_id)
    ).fetchone()
    if owns is None:
        raise LookupError("no such word")
    return _apply(
        conn, user_id, vocab_word_id, rating,
        source="flashcard", outcome=fsrs.RATING_NAMES[rating], now=now,
    )


def apply_conversation_outcomes(
    conn: sqlite3.Connection,
    user_id: str,
    session_id: str,
    outcomes: list[tuple[str, str]],
    *,
    now: datetime | None = None,
) -> list[dict]:
    """Spec §6.3, the mechanism that makes conversation count as study.

    Called when a session ends. Each target word's usage is rated on the same
    scale a flashcard would be, so the FSRS state evolves from real production
    exactly as it would from recognition — which is the whole argument the
    project is making."""
    results = []
    for vocab_word_id, outcome in outcomes:
        rating = CONVERSATION_RATINGS.get(outcome)
        if rating is None:
            continue
        results.append(
            _apply(
                conn, user_id, vocab_word_id, rating,
                source="conversation", outcome=outcome, session_id=session_id, now=now,
            )
        )
    return results


# --- overview ---------------------------------------------------------------


def due_count(conn: sqlite3.Connection, user_id: str, *, now: datetime | None = None) -> int:
    now = now or fsrs.utcnow()
    return conn.execute(
        "SELECT COUNT(*) AS n FROM review_cards "
        "WHERE user_id = ? AND suspended = 0 AND state != 'new' AND due <= ?",
        (user_id, _fmt(now)),
    ).fetchone()["n"]


def stats(conn: sqlite3.Connection, user_id: str, *, now: datetime | None = None) -> dict:
    """What the Review screen and the nav badge show before a session starts."""
    now = now or fsrs.utcnow()
    counts = conn.execute(
        """
        SELECT
          COUNT(*)                                                  AS total,
          SUM(CASE WHEN state = 'new' THEN 1 ELSE 0 END)            AS new_count,
          SUM(CASE WHEN suspended = 1 THEN 1 ELSE 0 END)            AS suspended_count,
          SUM(CASE WHEN suspended = 0 AND state != 'new' AND due <= ? THEN 1 ELSE 0 END) AS due_now
        FROM review_cards WHERE user_id = ?
        """,
        (_fmt(now), user_id),
    ).fetchone()

    # Spec §7: "Upcoming load forecast — reviews due over the next 30 days, so
    # backlogs are visible before they arrive."
    forecast = []
    for day in range(1, 31):
        start = (now + timedelta(days=day - 1)).replace(hour=0, minute=0, second=0, microsecond=0)
        end = start + timedelta(days=1)
        n = conn.execute(
            "SELECT COUNT(*) AS n FROM review_cards WHERE user_id = ? AND suspended = 0 "
            "AND state != 'new' AND due >= ? AND due < ?",
            (user_id, _fmt(start), _fmt(end)),
        ).fetchone()["n"]
        forecast.append({"date": start.strftime("%Y-%m-%d"), "count": n})

    reviewed_today = conn.execute(
        "SELECT COUNT(*) AS n FROM review_logs WHERE user_id = ? AND source = 'flashcard' AND created_at >= ?",
        (user_id, now.replace(hour=0, minute=0, second=0, microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")),
    ).fetchone()["n"]

    mastery_counts = [0] * 6
    for row in conn.execute(
        "SELECT rc.* FROM review_cards rc WHERE rc.user_id = ?", (user_id,)
    ):
        level = mastery_for(card_from_row(row), spontaneous_sessions(conn, row["vocab_word_id"])).level
        mastery_counts[level] += 1

    return {
        "due_now": counts["due_now"] or 0,
        "new_available": counts["new_count"] or 0,
        "total_cards": counts["total"] or 0,
        "suspended": counts["suspended_count"] or 0,
        "reviewed_today": reviewed_today,
        "target_retention": target_retention(conn, user_id),
        "forecast": forecast,
        "mastery_counts": mastery_counts,
    }


def set_suspended(conn: sqlite3.Connection, user_id: str, vocab_word_id: str, suspended: bool) -> bool:
    cur = conn.execute(
        "UPDATE review_cards SET suspended = ? WHERE vocab_word_id = ? AND user_id = ?",
        (1 if suspended else 0, vocab_word_id, user_id),
    )
    return cur.rowcount > 0
