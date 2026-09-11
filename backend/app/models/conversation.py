from typing import Literal

from pydantic import BaseModel

ScenarioKey = Literal["free", "coffee", "job", "debate"]
Channel = Literal["voice", "text"]
Speaker = Literal["user", "ai"]
UsageOutcome = Literal["spontaneous", "prompted", "incorrect", "avoided"]


class ConversationSessionCreate(BaseModel):
    user_id: str
    scenario: ScenarioKey
    channel: Channel = "text"


class ConversationTurnOut(BaseModel):
    id: str
    turn_index: int
    speaker: Speaker
    text: str
    audio_url: str | None
    stt_confidence: float | None
    created_at: str


class TargetWordOut(BaseModel):
    id: str
    word: str
    used_outcome: UsageOutcome | None  # None until end_session classifies it


class ConversationSessionOut(BaseModel):
    id: str
    user_id: str
    scenario: ScenarioKey
    channel: Channel
    target_words: list[TargetWordOut]
    started_at: str
    ended_at: str | None
    has_report: bool


class ConversationSessionDetailOut(ConversationSessionOut):
    turns: list[ConversationTurnOut]


class TurnSubmitOut(BaseModel):
    user_turn: ConversationTurnOut
    ai_turn: ConversationTurnOut


class ReportErrorOut(BaseModel):
    bad: str
    good: str
    why: str


class ReportRoutingRowOut(BaseModel):
    word: str
    outcome: UsageOutcome
    evidence_turn: int | None  # first turn_index the word appears in, if used


class ConversationReportOut(BaseModel):
    session_id: str
    contextual_accuracy_pct: int
    fluency_score: int
    vocabulary_reach_score: int
    pronunciation_score: int | None  # stt-confidence proxy; None for text-channel sessions (no audio to score)
    words_per_minute: int
    avg_pause_seconds: float
    self_corrections: int
    turn_count: int
    routing: list[ReportRoutingRowOut]
    errors: list[ReportErrorOut]
    summary: str


class EngineStatusOut(BaseModel):
    llm: str
    stt: str
    tts: str
