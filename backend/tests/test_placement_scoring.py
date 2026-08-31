from app.data.placement_questions import QUESTIONS
from app.services.placement_scoring import score_placement


def _all_correct_answers():
    return {q.id: q.correct_index for q in QUESTIONS}


def _wrong_index(q):
    return (q.correct_index + 1) % len(q.options)


def test_all_correct_scores_c2():
    result = score_placement(_all_correct_answers())
    assert result.estimated_cefr == "C2"
    assert result.raw_score == len(QUESTIONS)


def test_all_wrong_falls_back_to_floor_a1():
    answers = {q.id: _wrong_index(q) for q in QUESTIONS}
    result = score_placement(answers)
    assert result.estimated_cefr == "A1"
    assert result.raw_score == 0


def test_ceiling_stops_at_first_failed_band():
    answers = {}
    for q in QUESTIONS:
        if q.level in ("A1", "A2"):
            answers[q.id] = q.correct_index
        elif q.level == "B1":
            answers[q.id] = _wrong_index(q)
        else:
            # Correct answers above the ceiling must not count.
            answers[q.id] = q.correct_index

    result = score_placement(answers)
    assert result.estimated_cefr == "A2"


def test_exact_half_credit_passes_threshold():
    answers = {}
    for q in QUESTIONS:
        if q.level == "A1":
            answers[q.id] = q.correct_index if q.id != "a1-1" else _wrong_index(q)  # 2/3 correct
        else:
            answers[q.id] = _wrong_index(q)

    result = score_placement(answers)
    assert result.estimated_cefr == "A1"


def test_missing_answers_are_treated_as_incorrect():
    result = score_placement({})
    assert result.estimated_cefr == "A1"
    assert result.raw_score == 0
    assert result.total_questions == len(QUESTIONS)
