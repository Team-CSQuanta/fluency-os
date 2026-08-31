"""Scoring for the placement check (see app/data/placement_questions.py for
the honesty caveat: this is a heuristic screener, not a validated CEFR test).

Algorithm — a "ceiling" method common in lightweight placement tests: walk the
CEFR bands from A1 upward, and keep raising the estimate as long as the
learner answers at least half of that band's questions correctly. The first
band where accuracy drops below 50% is treated as the ceiling, and bands
above it are not counted even if isolated answers there are correct — a
learner who guesses one hard question right without the fundamentals is not
"C1", they are wherever their accuracy stops holding up.
"""

from dataclasses import dataclass

from app.data.placement_questions import CEFR_ORDER, QUESTIONS

PASS_THRESHOLD = 0.5


@dataclass(frozen=True)
class LevelBreakdown:
    level: str
    correct: int
    total: int
    accuracy: float


@dataclass(frozen=True)
class PlacementResult:
    estimated_cefr: str
    raw_score: int
    total_questions: int
    breakdown: tuple[LevelBreakdown, ...]


def score_placement(answers: dict[str, int]) -> PlacementResult:
    """answers: question_id -> selected option index."""
    by_level: dict[str, list[bool]] = {level: [] for level in CEFR_ORDER}
    raw_score = 0

    for q in QUESTIONS:
        is_correct = answers.get(q.id) == q.correct_index
        by_level[q.level].append(is_correct)
        if is_correct:
            raw_score += 1

    breakdown: list[LevelBreakdown] = []
    estimated: str | None = None

    for level in CEFR_ORDER:
        results = by_level[level]
        total = len(results)
        correct = sum(results)
        accuracy = (correct / total) if total else 0.0
        breakdown.append(LevelBreakdown(level=level, correct=correct, total=total, accuracy=accuracy))

        if total > 0 and accuracy >= PASS_THRESHOLD:
            estimated = level
        else:
            break

    return PlacementResult(
        estimated_cefr=estimated or CEFR_ORDER[0],
        raw_score=raw_score,
        total_questions=len(QUESTIONS),
        breakdown=tuple(breakdown),
    )
