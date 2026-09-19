"""Spec §8 — the Forest.

Every tree is one vocabulary word, and **nothing about a tree is stored**. Its
size is the word's FSRS stability, its health is how badly it has been
forgotten, and the ground it stands on is where the learner first met it. All
three are read from tables the rest of the app already maintains.

That is the whole design. A `trees` table would be a second record of facts the
scheduler already owns, and two records of the same fact drift: the forest
would show a thriving oak for a word `review` knows was lapsed last week. The
only thing here that is written down is what the learner has *spent*, because a
decision is not derivable from anything.

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

# Where a word was met becomes the ground it grows on. Keyed by
# vocab_contexts.kind, which the rest of the app already records.
BIOMES: dict[str, dict[str, str]] = {
    "meadow": {"label": "Meadow", "blurb": "Words you looked up and kept on purpose."},
    "cinema": {"label": "Cinema Clearing", "blurb": "Caught while watching something."},
    "library": {"label": "Library Grove", "blurb": "Met on a page."},
    "river": {"label": "Conversation Riverbank", "blurb": "Said out loud first."},
    "highlands": {"label": "Challenge Highlands", "blurb": "Reached for under time."},
}
# vocab_contexts.kind is constrained to exactly these three (see the vocabulary
# migration), and they map one-to-one onto where the learner was standing:
# a subtitle, a page, or a conversation turn.
_KIND_TO_BIOME = {"clip": "cinema", "page": "library", "turn": "river"}
_SOURCE_TO_BIOME = {"conversation": "river", "challenge": "highlands"}

# What a unit of real work is worth, in sunlight. Deliberately small and
# weighted towards production: saying a word you were not prompted with is the
# hardest thing on this list and the only one that cannot be done by accident.
SUNLIGHT_PER_OUTCOME = {
    "spontaneous": 5,
    "prompted": 3,
    "good": 2,
    "easy": 2,
    "hard": 1,
    "again": 1,
    "incorrect": 1,
    "avoided": 0,
}
SUNLIGHT_PER_FOCUS_MINUTE = 1

COSTS = {"streak_freeze": 200, "revive": 60}


@dataclass(frozen=True)
class Tree:
    vocab_word_id: str
    word: str
    biome: str
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


def _biome_for(kind: str | None, first_source: str | None) -> str:
    """Where the word was met. A word produced in conversation before it was
    ever saved belongs by the river, whatever page it later turned up on."""
    if first_source in _SOURCE_TO_BIOME:
        return _SOURCE_TO_BIOME[first_source]
    return _KIND_TO_BIOME.get(kind or "", "meadow")


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
               (SELECT c.kind FROM vocab_contexts c
                 WHERE c.vocab_word_id = w.id ORDER BY c.created_at LIMIT 1) AS first_kind,
               (SELECT l.source FROM review_logs l
                 WHERE l.vocab_word_id = w.id ORDER BY l.created_at LIMIT 1) AS first_source,
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
                biome=_biome_for(row["first_kind"], row["first_source"]),
                stage=stage_for(row["stability"], row["state"]),
                stability=round(row["stability"] or 0.0, 2),
                health=health,
                # Dormant, not dead. A month past due with no review is a tree
                # that has dropped its leaves, and reviving it is a thing the
                # learner can choose to spend on.
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
# Sunlight
# ---------------------------------------------------------------------------


def sunlight_earned(conn: sqlite3.Connection, user_id: str) -> int:
    """Every unit of sunlight the learner has ever earned.

    Derived, never banked. An earnings ledger would be a second copy of
    review_logs that could fall out of step with it — and the one thing a
    currency must not do is disagree with the work that produced it.
    """
    rows = conn.execute(
        "SELECT outcome, COUNT(*) AS n FROM review_logs WHERE user_id = ? GROUP BY outcome",
        (user_id,),
    ).fetchall()
    from_reviews = sum(SUNLIGHT_PER_OUTCOME.get(r["outcome"], 0) * r["n"] for r in rows)
    from_focus = conn.execute(
        "SELECT COALESCE(SUM(sunlight), 0) AS n FROM forest_focus_sessions "
        "WHERE user_id = ? AND completed_at IS NOT NULL",
        (user_id,),
    ).fetchone()["n"]
    return int(from_reviews + from_focus)


def sunlight_spent(conn: sqlite3.Connection, user_id: str) -> int:
    return int(
        conn.execute(
            "SELECT COALESCE(SUM(cost), 0) AS n FROM forest_spends WHERE user_id = ?", (user_id,)
        ).fetchone()["n"]
    )


def sunlight_balance(conn: sqlite3.Connection, user_id: str) -> int:
    return sunlight_earned(conn, user_id) - sunlight_spent(conn, user_id)


def spend(conn: sqlite3.Connection, *, user_id: str, kind: str, vocab_word_id: str | None = None) -> dict:
    """Buy something with sunlight. Refuses rather than going negative."""
    if kind not in COSTS:
        raise ValueError(f"nothing costs sunlight called {kind!r}")
    cost = COSTS[kind]
    balance = sunlight_balance(conn, user_id)
    if balance < cost:
        raise ValueError(f"that costs {cost} sunlight and you have {balance}")

    conn.execute(
        "INSERT INTO forest_spends (id, user_id, kind, cost, vocab_word_id, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (uuid7(), user_id, kind, cost, vocab_word_id, iso8601_utc_now()),
    )
    if kind == "revive" and vocab_word_id:
        # Unsuspend and bring the due date forward to now, so the tree is
        # awake and asking to be reviewed rather than quietly healed.
        conn.execute(
            "UPDATE review_cards SET suspended = 0, due = ? WHERE vocab_word_id = ? AND user_id = ?",
            (iso8601_utc_now(), vocab_word_id, user_id),
        )
    return {"kind": kind, "cost": cost, "balance": sunlight_balance(conn, user_id)}


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
    """Pay out only for a block that was actually sat through.

    The elapsed time is checked against the clock rather than trusted from the
    client: a timer that pays out on a button press is a button that prints
    sunlight.
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
    earned = row["minutes"] * SUNLIGHT_PER_FOCUS_MINUTE
    conn.execute(
        "UPDATE forest_focus_sessions SET completed_at = ?, sunlight = ? WHERE id = ?",
        (iso8601_utc_now(), earned, session_id),
    )
    return conn.execute("SELECT * FROM forest_focus_sessions WHERE id = ?", (session_id,)).fetchone()


def summary(conn: sqlite3.Connection, user_id: str) -> dict:
    """Everything the Forest screen needs, in one call."""
    all_trees = trees(conn, user_id)
    by_biome: dict[str, int] = {key: 0 for key in BIOMES}
    by_stage = [0] * len(STAGES)
    for tree in all_trees:
        by_biome[tree.biome] = by_biome.get(tree.biome, 0) + 1
        by_stage[tree.stage] += 1
    freezes = conn.execute(
        "SELECT COUNT(*) AS n FROM forest_spends WHERE user_id = ? AND kind = 'streak_freeze'",
        (user_id,),
    ).fetchone()["n"]
    return {
        "trees": all_trees,
        "biomes": by_biome,
        "stages": by_stage,
        "sunlight": sunlight_balance(conn, user_id),
        "sunlight_earned": sunlight_earned(conn, user_id),
        "streak_freezes": freezes,
        "dormant": sum(1 for t in all_trees if t.dormant),
        "costs": COSTS,
    }
