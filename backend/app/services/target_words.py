"""Which saved words a conversation asks the learner to use.

The old rule was "fewest review-log rows first, newest first", written before
the app had a scheduler. Three things had since made it wrong: flashcard
answers land in review_logs too, so reviewing a word on a card pushed it out
of conversation as if it had been spoken; it knew nothing of the learner's
level, so "several" was picked for a B1 learner; and it knew nothing of the
scene, so the barista was asked to steer toward "keyboard".

Each candidate is now scored on four things, in order of weight:

  need       — what the learner still has to do with it: due for review,
               never produced in conversation (the only way past mastery
               level 2), used wrongly last time; mastered words step back.
  level fit  — at or a little above the learner's level is where practice
               pays; below it there is little left to learn.
  scene fit  — words that belong in this scene can be used naturally, so
               the partner does not have to force them in.
  variety    — words just targeted last session step back a little.

Every score comes with the reason it was picked, which the conversation
screen shows beside the word.
"""

import json
import re
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone

from app.services import cefr_lexicon, review
from app.services.fsrs import Card
from app.services.scenarios import Scenario

TARGET_WORD_COUNT = 8

# A word defined only by a stand-in cannot be explained to the partner, so it
# cannot be a target: "(no definition yet — x)", "(saved from <film>)".
_PLACEHOLDER = ("(no definition yet", "(saved from ")

_STOPWORDS = frozenset(
    """a an the and or but if of to in on at by for with from as into onto about over under after before
    is are was were be been being am do does did doing have has had having can could will would shall should
    may might must not no yes this that these those it its they them their there here he she him her his hers
    you your yours we us our i me my mine who whom whose which what when where why how than then so too very
    just also only some any each every all both either neither one two more most less least much many few
    such own same other another up down out off again further once ever never always often
    someone something somebody anything everything nothing person people thing things way ways
    learner learners ask asks asked say says said tell tells make makes made get gets got give gives take
    takes let lets use used using like want wants need needs know knows see seen go goes going come comes
    stay keep keeps natural naturally scene conversation reply replies question questions step steps
    """.split()
)

_TOKEN = re.compile(r"[a-z][a-z'\-]*")


def _stem(token: str) -> str:
    """Crude, but the same on both sides of the comparison — which is all a
    match needs. "ordering", "orders" and "ordered" all meet "order"."""
    t = token.lower().strip("'-").removesuffix("'s")
    for suffix, keep in (("ies", "y"), ("ing", ""), ("ed", ""), ("es", ""), ("ly", ""), ("s", "")):
        if t.endswith(suffix) and len(t) - len(suffix) >= 3 and not (suffix == "s" and t.endswith("ss")):
            return t[: len(t) - len(suffix)] + keep
    return t


def _content_stems(text: str) -> set[str]:
    return {_stem(t) for t in _TOKEN.findall(text.lower()) if t not in _STOPWORDS and len(t) > 2}


def scene_stems(scenario: Scenario) -> set[str]:
    """Everything the scene is about, as comparable stems."""
    parts = [
        scenario.label,
        scenario.summary,
        scenario.setting,
        scenario.goal,
        scenario.learner_role,
        scenario.persona.role,
        *scenario.arc,
        *scenario.rules,
        *scenario.topics,
    ]
    return _content_stems(" ".join(parts))


def scene_fit(word: str, definition: str | None, scene: set[str]) -> int:
    """0-3: how much this word belongs in the scene. The word itself in the
    scene counts double; each shared idea in its definition counts once."""
    score = 2 if _stem(word) in scene else 0
    score += len(_content_stems(definition or "") & scene)
    return min(3, score)


@dataclass(frozen=True)
class Candidate:
    """What the score is computed from — kept free of the database so the
    scoring can be tested on its own."""

    word: str
    band: str | None
    #: Mastery level 0-5 (review.mastery_for).
    mastery: int
    #: Never reviewed on a card and never used in conversation.
    is_new: bool
    #: Days past its review date; 0 when not due.
    overdue_days: float
    #: Times produced in conversation (spontaneous, prompted or incorrect).
    produced: int
    #: The most recent conversation outcome, if any.
    last_outcome: str | None
    fit: int
    #: A target in the learner's previous session.
    just_targeted: bool


def score(c: Candidate, level: str) -> tuple[float, list[str]]:
    """The score, and the reasons worth telling the learner."""
    s = 0.0
    why: list[str] = []

    # need
    if c.last_outcome == "incorrect":
        # The strongest signal there is: they reached for it and missed.
        s += 5.0
        why.append("retry")
    if c.overdue_days > 0:
        s += 3.0 + min(1.0, c.overdue_days / 7)
        why.append("due")
    if c.is_new:
        s += 2.0
        why.append("new")
    if c.mastery >= 5:
        s -= 4.0
    elif c.produced == 0:
        # Flashcards stop at level 2; only saying it moves it further.
        s += 1.5
        if not c.is_new:
            why.append("not said yet")
    s -= 0.5 * min(c.produced, 4)

    # level fit
    learner = cefr_lexicon.CEFR_ORDER.index(level) if level in cefr_lexicon.CEFR_ORDER else 2
    if c.band in cefr_lexicon.CEFR_ORDER:
        gap = cefr_lexicon.CEFR_ORDER.index(c.band) - learner
        if gap < 0:
            s -= 1.5 * -gap
        elif gap <= 1:
            s += 1.0
            if gap == 1:
                why.append("stretch")
        elif gap >= 3:
            s -= 0.5

    # scene fit
    s += (2.0 / 3) * c.fit
    if c.fit >= 2:
        why.append("fits scene")

    # variety
    if c.just_targeted and c.last_outcome != "incorrect":
        s -= 0.75

    return s, why


def _utc(ts: str | None) -> datetime | None:
    return datetime.fromisoformat(ts.replace("Z", "+00:00")) if ts else None


@dataclass(frozen=True)
class Pick:
    row: sqlite3.Row
    reason: str


def select(
    conn: sqlite3.Connection,
    user_id: str,
    scenario: Scenario,
    level: str,
    *,
    now: datetime | None = None,
    count: int = TARGET_WORD_COUNT,
) -> list[Pick]:
    now = now or datetime.now(timezone.utc)
    rows = conn.execute(
        """
        SELECT w.id, w.word, w.definition, w.cefr, w.created_at,
               rc.state, rc.due, rc.stability, rc.difficulty, rc.reps, rc.lapses, rc.last_review
        FROM vocab_words w
        LEFT JOIN review_cards rc ON rc.vocab_word_id = w.id
        WHERE w.user_id = ?
          AND COALESCE(rc.suspended, 0) = 0
          AND w.definition IS NOT NULL AND TRIM(w.definition) != ''
          AND w.definition NOT LIKE ? AND w.definition NOT LIKE ?
        """,
        (user_id, f"{_PLACEHOLDER[0]}%", f"{_PLACEHOLDER[1]}%"),
    ).fetchall()
    if not rows:
        return []

    # Conversation evidence only. Flashcard answers share review_logs, and
    # counting them made a word reviewed on a card look already spoken.
    evidence = {
        r["vocab_word_id"]: r
        for r in conn.execute(
            """
            SELECT l.vocab_word_id,
                   SUM(CASE WHEN l.outcome IN ('spontaneous', 'prompted', 'incorrect') THEN 1 ELSE 0 END)
                       AS produced,
                   COUNT(DISTINCT CASE WHEN l.outcome = 'spontaneous' THEN COALESCE(l.session_id, l.id) END)
                       AS spontaneous_sessions,
                   (SELECT l2.outcome FROM review_logs l2
                     WHERE l2.vocab_word_id = l.vocab_word_id AND l2.source = 'conversation'
                     ORDER BY l2.created_at DESC, l2.id DESC LIMIT 1) AS last_outcome
            FROM review_logs l
            WHERE l.user_id = ? AND l.source = 'conversation'
            GROUP BY l.vocab_word_id
            """,
            (user_id,),
        )
    }
    last_session = conn.execute(
        "SELECT target_word_ids FROM conversation_sessions WHERE user_id = ? ORDER BY started_at DESC LIMIT 1",
        (user_id,),
    ).fetchone()
    just_targeted = set(json.loads(last_session["target_word_ids"])) if last_session else set()

    scene = scene_stems(scenario)
    scored: list[tuple[float, str, sqlite3.Row, list[str]]] = []
    for row in rows:
        ev = evidence.get(row["id"])
        produced = int(ev["produced"] or 0) if ev else 0
        spont = int(ev["spontaneous_sessions"] or 0) if ev else 0
        state = row["state"] or "new"
        card = Card(
            stability=row["stability"] or 0.0,
            difficulty=row["difficulty"] or 0.0,
            due=_utc(row["due"]),
            last_review=_utc(row["last_review"]),
            reps=row["reps"] or 0,
            lapses=row["lapses"] or 0,
            state=state,
        )
        due = card.due
        overdue = (now - due).total_seconds() / 86400 if state != "new" and due and due <= now else 0.0
        candidate = Candidate(
            word=row["word"],
            band=(row["cefr"] or cefr_lexicon.band_of(row["word"]) or "").upper() or None,
            mastery=review.mastery_for(card, spont).level,
            is_new=state == "new" and produced == 0,
            overdue_days=max(0.0, overdue),
            produced=produced,
            last_outcome=ev["last_outcome"] if ev else None,
            fit=scene_fit(row["word"], row["definition"], scene),
            just_targeted=row["id"] in just_targeted,
        )
        points, why = score(candidate, level)
        scored.append((points, row["created_at"], row, why))

    # Highest score first; among equals, the most recently saved.
    scored.sort(key=lambda x: (x[0], x[1]), reverse=True)
    return [Pick(row, " · ".join(why[:2]) or "practice") for _, _, row, why in scored[:count]]
