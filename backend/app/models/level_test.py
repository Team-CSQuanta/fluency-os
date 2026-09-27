from pydantic import BaseModel


class LevelStandingOut(BaseModel):
    level: str
    #: "current" | "above" | "below"
    relation: str
    #: When a recent failure lets this level be tried again, if it is waiting.
    retry_after: str | None


class LevelAttemptSummaryOut(BaseModel):
    id: str
    level: str
    from_level: str | None
    correct: int | None
    total: int | None
    passed: bool
    submitted_at: str | None


class LevelTestOverviewOut(BaseModel):
    current: str | None
    questions: int
    pass_share: float
    minutes: int
    retry_hours: int
    levels: list[LevelStandingOut]
    history: list[LevelAttemptSummaryOut]


class LevelTestStartIn(BaseModel):
    user_id: str
    level: str


class LevelQuestionOut(BaseModel):
    id: str
    skill: str
    passage: str | None
    prompt: str
    options: list[str]
    # The answer is never sent.


class LevelAttemptOut(BaseModel):
    id: str
    level: str
    expires_at: str
    pass_mark: int
    questions: list[LevelQuestionOut]


class LevelTestSubmitIn(BaseModel):
    user_id: str
    #: The chosen option per question, in order; null for unanswered.
    answers: list[int | None]


class SkillScoreOut(BaseModel):
    skill: str
    name: str
    correct: int
    total: int


class LevelTestResultOut(BaseModel):
    level: str
    passed: bool
    correct: int
    total: int
    pass_mark: int
    by_skill: list[SkillScoreOut]
    new_level: str | None
    retry_after: str | None


class LevelMoveDownIn(BaseModel):
    user_id: str
    level: str
