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
    # "Practise this again": reuse a previous session's target words instead of
    # selecting a fresh set. Omitted for a normal new conversation.
    seed_word_ids: list[str] | None = None


class ConversationTurnOut(BaseModel):
    id: str
    turn_index: int
    speaker: Speaker
    text: str
    audio_url: str | None
    # How many sentence-sized audio pieces this turn can produce. Each is
    # fetched (and synthesized) separately so the first can start playing
    # while the rest are still being made.
    audio_chunk_count: int = 0
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
    # The engine this session is pinned to, which is not necessarily the one
    # Settings currently points at — 'local' | 'openrouter' | 'gemini'.
    engine_provider: str
    engine_label: str


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
    """Every field added after v1 carries a default, so a report written by an
    older version still opens instead of 500-ing on validation. `None` means
    "not measured", which is deliberately distinct from a measured zero — the
    v1 schema could not express that difference, which is how four permanently
    -zero fields went unnoticed for so long."""

    session_id: str
    # 1 = the original shape. Lets the UI say "not measured in this report"
    # rather than drawing a zero dial for something never computed.
    report_version: int = 1
    summary: str
    turn_count: int
    routing: list[ReportRoutingRowOut] = []
    errors: list[ReportErrorOut] = []

    # Dials, all 0-100. None where the session gave nothing to measure.
    contextual_accuracy_pct: int | None = None  # None when the session had no target words
    grammatical_precision: int | None = None
    lexical_range: int | None = None  # type-token ratio as a percentage
    pronunciation_score: int | None = None  # stt-confidence proxy; None for text sessions

    # Fluency proxies.
    words_per_minute: int | None = None  # None without measured speech time (text sessions, pre-v2 turns)
    filler_rate_per_100w: float | None = None
    avg_response_delay_seconds: float | None = None  # how long before the learner started answering
    longest_run_words: int | None = None
    type_token_ratio: float | None = None
    above_level_words: list[str] = []
    self_corrections: int | None = None


class EngineStatusOut(BaseModel):
    llm: str
    stt: str
    tts: str
