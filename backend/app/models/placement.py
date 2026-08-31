from pydantic import BaseModel


class PlacementQuestionOut(BaseModel):
    id: str
    level: str
    category: str
    prompt: str
    options: tuple[str, str, str, str]
    # correct_index is intentionally omitted — never sent to the client.


class PlacementAnswer(BaseModel):
    question_id: str
    selected_index: int


class PlacementSubmission(BaseModel):
    answers: list[PlacementAnswer]


class LevelBreakdownOut(BaseModel):
    level: str
    correct: int
    total: int
    accuracy: float


class PlacementResultOut(BaseModel):
    estimated_cefr: str
    raw_score: int
    total_questions: int
    breakdown: list[LevelBreakdownOut]
