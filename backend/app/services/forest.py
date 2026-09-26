"""Spec §8 — the Forest.

Every tree is one vocabulary word, and **nothing about a tree is stored**. Its
size is the word's FSRS stability and its health is how badly it has been
forgotten, both read from tables the rest of the app already maintains.

A `trees` table would be a second record of facts the scheduler already owns,
and two records of the same fact drift: the forest would show a thriving oak
for a word `review` knows was lapsed last week. Only focus sessions are
written here, because sitting one out is a decision, not a derivation.

The effect worth having is that the forest cannot be gamed or faked. It grows
only when the learner's memory does, because it is a drawing of their memory.
"""

import sqlite3
from dataclasses import dataclass

from app.utils.ids import uuid7
from app.utils.time import iso8601_utc_now

# ---------------------------------------------------------------------------
# Growth
# ---------------------------------------------------------------------------
# FSRS stability is "days until recall falls to 90%", so it is already a
# measure of how well-rooted a word is — the stages are just readable names for
# bands of it. The thresholds climb roughly threefold, because that is how
# stability itself grows: the distance from Seed to Sprout is a day, and from
# Young tree to Ancient is a couple of months.
STAGES = ("Seed", "Sprout", "Seedling", "Sapling", "Young tree", "Ancient tree")
STAGE_DAYS = (1.0, 3.0, 7.0, 21.0, 60.0)

@dataclass(frozen=True)
class Tree:
    vocab_word_id: str
    word: str
    stage: int
    stability: float
    health: int
    dormant: bool
    lapses: int
    spontaneous_uses: int
    due: str | None


def stage_for(stability: float | None, state: str | None) -> int:
    """Which of the six stages a card's stability puts it in."""
    if state == "new" or not stability:
        return 0
    for i, threshold in enumerate(STAGE_DAYS):
        if stability < threshold:
            return i
    return len(STAGES) - 1


def health_for(*, lapses: int, overdue_days: float) -> int:
    """0-100. Lapses are permanent scars; being overdue is a current wilt.

    Kept apart on purpose: a word forgotten three times and relearned is not in
    trouble *now*, and a word never forgotten but three weeks overdue is. One
    number that mixed them would say the same thing about both.
    """
    scarred = max(0, 100 - lapses * 12)
    if overdue_days <= 0:
        return scarred
    # Full health to nothing over a fortnight overdue.
    wilt = min(1.0, overdue_days / 14.0)
    return max(0, round(scarred * (1.0 - wilt)))


def trees(conn: sqlite3.Connection, user_id: str) -> list[Tree]:
    """The whole forest, one row per saved word.

    A single query rather than a query per tree: a learner with two thousand
    words would otherwise open this screen on two thousand round trips.
    """
    now = iso8601_utc_now()
    rows = conn.execute(
        """
        SELECT w.id, w.word,
               r.stability, r.state, r.lapses, r.due, r.suspended,
               (SELECT COUNT(*) FROM review_logs l
                 WHERE l.vocab_word_id = w.id AND l.outcome = 'spontaneous') AS spontaneous
          FROM vocab_words w
          LEFT JOIN review_cards r ON r.vocab_word_id = w.id
         WHERE w.user_id = ?
         ORDER BY w.created_at
        """,
        (user_id,),
    ).fetchall()

    out: list[Tree] = []
    for row in rows:
        overdue = _days_between(row["due"], now) if row["due"] else 0.0
        health = health_for(lapses=row["lapses"] or 0, overdue_days=max(0.0, overdue))
        out.append(
            Tree(
                vocab_word_id=row["id"],
                word=row["word"],
                stage=stage_for(row["stability"], row["state"]),
                stability=round(row["stability"] or 0.0, 2),
                health=health,
                # Dormant, not dead: a month past due with no review is a
                # tree that has dropped its leaves. Reviewing it wakes it.
                dormant=bool(row["suspended"]) or overdue > 30,
                lapses=row["lapses"] or 0,
                spontaneous_uses=row["spontaneous"] or 0,
                due=row["due"],
            )
        )
    return out


def _days_between(earlier_iso: str, later_iso: str) -> float:
    from datetime import datetime

    def parse(value: str) -> datetime:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))

    return (parse(later_iso) - parse(earlier_iso)).total_seconds() / 86400.0


# ---------------------------------------------------------------------------
# Focus sessions
# ---------------------------------------------------------------------------


def start_focus(conn: sqlite3.Connection, *, user_id: str, minutes: int) -> sqlite3.Row:
    if minutes <= 0 or minutes > 180:
        raise ValueError("a focus session runs between 1 and 180 minutes")
    session_id = uuid7()
    conn.execute(
        "INSERT INTO forest_focus_sessions (id, user_id, minutes, started_at) VALUES (?, ?, ?, ?)",
        (session_id, user_id, minutes, iso8601_utc_now()),
    )
    return conn.execute("SELECT * FROM forest_focus_sessions WHERE id = ?", (session_id,)).fetchone()


def complete_focus(conn: sqlite3.Connection, *, session_id: str, user_id: str) -> sqlite3.Row:
    """Mark a block as sat through, if it really was.

    The elapsed time is checked against the clock rather than trusted from the
    client. Nothing is paid for it — the session is a commitment to sit still
    for a while, and the record of having done it is the whole point.
    """
    row = conn.execute(
        "SELECT * FROM forest_focus_sessions WHERE id = ? AND user_id = ?", (session_id, user_id)
    ).fetchone()
    if row is None:
        raise ValueError("no such focus session")
    if row["completed_at"]:
        return row

    elapsed = _days_between(row["started_at"], iso8601_utc_now()) * 24 * 60
    # A little slack for the round trip, and none for stopping early.
    if elapsed + 0.5 < row["minutes"]:
        raise ValueError(
            f"that session has {max(0, round(row['minutes'] - elapsed))} minutes left to run"
        )
    conn.execute(
        "UPDATE forest_focus_sessions SET completed_at = ? WHERE id = ?",
        (iso8601_utc_now(), session_id),
    )
    return conn.execute("SELECT * FROM forest_focus_sessions WHERE id = ?", (session_id,)).fetchone()


def summary(conn: sqlite3.Connection, user_id: str) -> dict:
    """Everything the Forest screen needs, in one call."""
    all_trees = trees(conn, user_id)
    by_stage = [0] * len(STAGES)
    for tree in all_trees:
        by_stage[tree.stage] += 1
    return {
        "trees": all_trees,
        "stages": by_stage,
        "dormant": sum(1 for t in all_trees if t.dormant),
    }
