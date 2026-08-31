from fastapi import APIRouter, Depends

from app.data.placement_questions import QUESTIONS
from app.models.placement import (
    LevelBreakdownOut,
    PlacementQuestionOut,
    PlacementResultOut,
    PlacementSubmission,
)
from app.security import require_token
from app.services.placement_scoring import score_placement

router = APIRouter(prefix="/placement", dependencies=[Depends(require_token)])


@router.get("/questions", response_model=list[PlacementQuestionOut])
def get_questions() -> list[PlacementQuestionOut]:
    return [
        PlacementQuestionOut(id=q.id, level=q.level, category=q.category, prompt=q.prompt, options=q.options)
        for q in QUESTIONS
    ]


@router.post("/score", response_model=PlacementResultOut)
def submit_score(payload: PlacementSubmission) -> PlacementResultOut:
    answers = {a.question_id: a.selected_index for a in payload.answers}
    result = score_placement(answers)
    return PlacementResultOut(
        estimated_cefr=result.estimated_cefr,
        raw_score=result.raw_score,
        total_questions=result.total_questions,
        breakdown=[
            LevelBreakdownOut(level=b.level, correct=b.correct, total=b.total, accuracy=b.accuracy)
            for b in result.breakdown
        ],
    )
