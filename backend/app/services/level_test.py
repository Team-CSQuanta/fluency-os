"""The level test: passing it is the only way to move UP a CEFR level.

A level a learner chooses for themselves is a level every difficulty measure
in the app then trusts — reading tints, target words, the conversation
partner's language, report comparisons. So going up has to be earned; going
down (the material feels too hard) never needs a test.

Why the test is hard to game:

  - Each level has its own pool of questions, and B2 and above add vocabulary
    questions generated from the lexicon, so a test is a random draw.
  - Answer choices are shuffled per test.
  - Questions served in the learner's recent attempts are avoided while the
    pool allows.
  - The answers stay on the server: the client gets the questions, sends back
    its choices, and is told the score.
  - A failed attempt at a level has to wait before that level can be tried
    again, so the test cannot simply be retaken until the draw is kind.
"""

import json
import math
import random
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from app.data.level_test_bank import BANK, BankQuestion
from app.services import cefr_lexicon
from app.utils.ids import uuid7

LEVELS = cefr_lexicon.CEFR_ORDER

#: Questions at the level being tested for, and from the level below.
AT_LEVEL = 12
BELOW_LEVEL = 3
#: The share of all questions to get right.
PASS_SHARE = 0.8
TIME_LIMIT = timedelta(minutes=25)
#: A little allowance for the answers' trip back after the clock runs out.
_SUBMIT_GRACE = timedelta(seconds=60)
#: After failing a level, how long before it can be tried again.
RETRY_WAIT = timedelta(hours=4)
#: Questions from this many recent attempts are avoided where possible.
_RECENT_ATTEMPTS = 3
#: At most this share of a level's questions are generated ones.
_GENERATED_SHARE = 0.35

SKILL_NAMES = {"grammar": "Grammar", "vocabulary": "Vocabulary", "reading": "Reading"}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _fmt(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse(ts: str) -> datetime:
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


def rank(level: str | None) -> int:
    """-1 for no level yet."""
    return LEVELS.index(level) if level in LEVELS else -1


def pass_mark(total: int) -> int:
    return math.ceil(total * PASS_SHARE)


# --- questions ----------------------------------------------------------------


def generated(level: str, rng: random.Random) -> list[BankQuestion]:
    """Vocabulary questions made from the lexicon's words at this level, which
    carry a definition and a plainer synonym. Two kinds, from the same data:
    the word for a meaning, and the closest simpler word to a word. The pool
    is every word at the level, so the combinations are far past memorising."""
    entries = [
        e
        for e in cefr_lexicon._load().values()
        if e.cefr == level and e.definition and e.simpler and " " not in e.lemma
    ]
    if len(entries) < 4:
        return []
    out: list[BankQuestion] = []
    for entry in entries:
        others = [e for e in entries if e.lemma != entry.lemma]
        rng.shuffle(others)
        # The word for a meaning — the definition must not give the word away.
        if entry.lemma.lower()[:5] not in entry.definition.lower():
            same_pos = [e for e in others if e.pos == entry.pos] or others
            wrong = [e.lemma for e in same_pos[:3]]
            if len(wrong) == 3:
                out.append(
                    BankQuestion(
                        id=f"gen-{level.lower()}-meaning-{entry.lemma}",
                        level=level,
                        skill="vocabulary",
                        prompt=f"Which word means “{entry.definition}”?",
                        choices=(entry.lemma, *wrong),  # type: ignore[arg-type]
                    )
                )
        # The nearest plainer word — distractors that are not also near it.
        near = {entry.simpler.lower(), *(s.lower() for s in entry.synonyms)}
        wrong_simple: list[str] = []
        for e in others:
            s = e.simpler.strip()
            if s.lower() not in near and s.lower() not in (w.lower() for w in wrong_simple):
                wrong_simple.append(s)
            if len(wrong_simple) == 3:
                break
        if len(wrong_simple) == 3:
            out.append(
                BankQuestion(
                    id=f"gen-{level.lower()}-synonym-{entry.lemma}",
                    level=level,
                    skill="vocabulary",
                    prompt=f"Which is closest in meaning to “{entry.lemma}”?",
                    choices=(entry.simpler, *wrong_simple),  # type: ignore[arg-type]
                )
            )
    return out


def _recently_seen(conn: sqlite3.Connection, user_id: str) -> set[str]:
    seen: set[str] = set()
    for row in conn.execute(
        "SELECT questions FROM level_test_attempts WHERE user_id = ? ORDER BY started_at DESC LIMIT ?",
        (user_id, _RECENT_ATTEMPTS),
    ):
        seen.update(q["id"] for q in json.loads(row["questions"]))
    return seen


def _draw(pool: list[BankQuestion], count: int, seen: set[str], rng: random.Random) -> list[BankQuestion]:
    """`count` questions, unseen ones first, with the skills mixed rather than
    all of one kind when the pool allows."""
    fresh = [q for q in pool if q.id not in seen]
    stale = [q for q in pool if q.id in seen]
    rng.shuffle(fresh)
    rng.shuffle(stale)
    picked: list[BankQuestion] = []
    # Round-robin over skills among the fresh ones, so a draw is a real mix.
    by_skill: dict[str, list[BankQuestion]] = {}
    for q in fresh:
        by_skill.setdefault(q.skill, []).append(q)
    while len(picked) < count and any(by_skill.values()):
        for skill in list(by_skill):
            if by_skill[skill] and len(picked) < count:
                picked.append(by_skill[skill].pop())
    picked.extend(stale[: count - len(picked)])
    return picked


def build(conn: sqlite3.Connection, user_id: str, level: str, rng: random.Random | None = None) -> list[dict]:
    """The questions for one attempt, answers included (kept server-side)."""
    rng = rng or random.Random()
    seen = _recently_seen(conn, user_id)

    def pool_for(lvl: str) -> list[BankQuestion]:
        hand = list(BANK[lvl])
        gen = generated(lvl, rng)
        rng.shuffle(gen)
        # Enough generated questions to widen the pool without letting them
        # crowd out grammar and reading.
        room = max(0, math.ceil(len(hand) * _GENERATED_SHARE / (1 - _GENERATED_SHARE)))
        return hand + gen[:room]

    below = LEVELS[rank(level) - 1] if rank(level) > 0 else None
    chosen = _draw(pool_for(level), AT_LEVEL + (0 if below else BELOW_LEVEL), seen, rng)
    if below:
        chosen += _draw(pool_for(below), BELOW_LEVEL, seen, rng)
    rng.shuffle(chosen)

    served = []
    for q in chosen:
        options = list(q.choices)
        rng.shuffle(options)
        served.append(
            {
                "id": q.id,
                "level": q.level,
                "skill": q.skill,
                "passage": q.passage,
                "prompt": q.prompt,
                "options": options,
                "answer": options.index(q.choices[0]),
            }
        )
    return served


# --- attempts -------------------------------------------------------------------


class LevelTestError(Exception):
    """Something the learner can act on — shown as it is."""


def current_level(conn: sqlite3.Connection, user_id: str) -> str | None:
    row = conn.execute("SELECT cefr_level FROM users WHERE id = ?", (user_id,)).fetchone()
    if row is None:
        raise LookupError("no such user")
    return row["cefr_level"]


def retry_after(conn: sqlite3.Connection, user_id: str, level: str, now: datetime | None = None) -> datetime | None:
    """When this level can be tried again, if a recent failure says wait."""
    now = now or _now()
    # A failure is a marked attempt that did not pass — or one left to run out
    # of time, which would otherwise be a free look at the questions.
    row = conn.execute(
        "SELECT COALESCE(submitted_at, expires_at) AS ended FROM level_test_attempts "
        "WHERE user_id = ? AND level = ? "
        "  AND (passed = 0 OR (submitted_at IS NULL AND expires_at < ?)) "
        "ORDER BY ended DESC LIMIT 1",
        (user_id, level, _fmt(now - _SUBMIT_GRACE)),
    ).fetchone()
    if row is None or not row["ended"]:
        return None
    until = _parse(row["ended"]) + RETRY_WAIT
    return until if until > now else None


def start(conn: sqlite3.Connection, user_id: str, level: str, *, now: datetime | None = None) -> dict:
    now = now or _now()
    if level not in LEVELS:
        raise LevelTestError(f"{level} is not a CEFR level.")
    current = current_level(conn, user_id)
    if rank(level) <= rank(current):
        raise LevelTestError(
            f"You are already at {current}. The test is for moving up — you can move down without one."
        )
    # A test already under way for this level is picked up where it was, not
    # replaced — starting over must not be a way to see more questions.
    open_row = conn.execute(
        "SELECT * FROM level_test_attempts WHERE user_id = ? AND level = ? AND submitted_at IS NULL "
        "AND expires_at > ? ORDER BY started_at DESC LIMIT 1",
        (user_id, level, _fmt(now)),
    ).fetchone()
    if open_row is not None:
        return attempt_out(open_row)
    wait = retry_after(conn, user_id, level, now)
    if wait is not None:
        raise LevelTestError(
            f"You can try {level} again after {wait.astimezone().strftime('%H:%M')} — "
            "a pause between attempts is part of the test."
        )
    questions = build(conn, user_id, level)
    attempt_id = uuid7()
    conn.execute(
        "INSERT INTO level_test_attempts (id, user_id, level, from_level, questions, started_at, expires_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (attempt_id, user_id, level, current, json.dumps(questions), _fmt(now), _fmt(now + TIME_LIMIT)),
    )
    conn.commit()
    return attempt_out(conn.execute("SELECT * FROM level_test_attempts WHERE id = ?", (attempt_id,)).fetchone())


def attempt_out(row: sqlite3.Row) -> dict:
    """The attempt as the client sees it: no answers."""
    questions = json.loads(row["questions"])
    return {
        "id": row["id"],
        "level": row["level"],
        "expires_at": row["expires_at"],
        "pass_mark": pass_mark(len(questions)),
        "questions": [
            {k: q[k] for k in ("id", "skill", "passage", "prompt", "options")} for q in questions
        ],
    }


@dataclass
class Result:
    level: str
    passed: bool
    correct: int
    total: int
    pass_mark: int
    by_skill: list[dict]
    new_level: str | None
    retry_after: str | None


def submit(
    conn: sqlite3.Connection, user_id: str, attempt_id: str, answers: list[int | None], *, now: datetime | None = None
) -> Result:
    now = now or _now()
    row = conn.execute(
        "SELECT * FROM level_test_attempts WHERE id = ? AND user_id = ?", (attempt_id, user_id)
    ).fetchone()
    if row is None:
        raise LookupError("no such attempt")
    if row["submitted_at"]:
        raise LevelTestError("This test has already been marked.")
    questions = json.loads(row["questions"])
    late = now > _parse(row["expires_at"]) + _SUBMIT_GRACE

    # Unanswered, out of range or late all count as wrong: a test with a clock
    # is marked on what was answered in time.
    marks = [
        (not late) and i < len(answers) and answers[i] is not None and answers[i] == q["answer"]
        for i, q in enumerate(questions)
    ]
    correct = sum(marks)
    total = len(questions)
    passed = correct >= pass_mark(total)

    by_skill: dict[str, list[int]] = {}
    for q, ok in zip(questions, marks, strict=True):
        tally = by_skill.setdefault(q["skill"], [0, 0])
        tally[0] += int(ok)
        tally[1] += 1

    conn.execute(
        "UPDATE level_test_attempts SET submitted_at = ?, correct = ?, total = ?, passed = ? WHERE id = ?",
        (_fmt(now), correct, total, int(passed), attempt_id),
    )
    new_level = None
    if passed and rank(row["level"]) > rank(current_level(conn, user_id)):
        conn.execute("UPDATE users SET cefr_level = ? WHERE id = ?", (row["level"], user_id))
        new_level = row["level"]
    conn.commit()

    wait = None if passed else _fmt(now + RETRY_WAIT)
    return Result(
        level=row["level"],
        passed=passed,
        correct=correct,
        total=total,
        pass_mark=pass_mark(total),
        by_skill=[
            {"skill": s, "name": SKILL_NAMES.get(s, s), "correct": c, "total": t}
            for s, (c, t) in sorted(by_skill.items())
        ],
        new_level=new_level,
        retry_after=wait,
    )


def move_down(conn: sqlite3.Connection, user_id: str, level: str) -> None:
    """Going down never needs a test."""
    if level not in LEVELS:
        raise LevelTestError(f"{level} is not a CEFR level.")
    current = current_level(conn, user_id)
    if rank(level) >= rank(current) and current is not None:
        raise LevelTestError("Moving up a level needs the level test.")
    conn.execute("UPDATE users SET cefr_level = ? WHERE id = ?", (level, user_id))
    conn.commit()


def overview(conn: sqlite3.Connection, user_id: str, *, now: datetime | None = None) -> dict:
    """What the Account page shows: each level's standing, and past attempts."""
    now = now or _now()
    current = current_level(conn, user_id)
    levels = []
    for lvl in LEVELS:
        wait = retry_after(conn, user_id, lvl, now) if rank(lvl) > rank(current) else None
        levels.append(
            {
                "level": lvl,
                "relation": "current" if lvl == current else ("above" if rank(lvl) > rank(current) else "below"),
                "retry_after": _fmt(wait) if wait else None,
            }
        )
    history = [
        {
            "id": r["id"],
            "level": r["level"],
            "from_level": r["from_level"],
            "correct": r["correct"],
            "total": r["total"],
            "passed": bool(r["passed"]),
            "submitted_at": r["submitted_at"],
        }
        for r in conn.execute(
            "SELECT * FROM level_test_attempts WHERE user_id = ? AND submitted_at IS NOT NULL "
            "ORDER BY submitted_at DESC LIMIT 10",
            (user_id,),
        )
    ]
    return {
        "current": current,
        "questions": AT_LEVEL + BELOW_LEVEL,
        "pass_share": PASS_SHARE,
        "minutes": int(TIME_LIMIT.total_seconds() // 60),
        "retry_hours": int(RETRY_WAIT.total_seconds() // 3600),
        "levels": levels,
        "history": history,
    }
