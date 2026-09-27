from typing import Literal

from pydantic import BaseModel

# A key from services/scenarios.py, or "custom" for one the learner wrote.
# A plain string: the catalog grows, and the service checks the key.
ScenarioKey = str
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
    #: With scenario "custom": which of the learner's own scenes to run.
    custom_scenario_id: str | None = None
    #: Run the same scene as this earlier session (overrides `scenario`).
    repeat_of: str | None = None


class ScenarioOut(BaseModel):
    key: str
    label: str
    summary: str
    minutes: int
    level: str
    persona_name: str
    persona_role: str
    learner_role: str


class ScenarioCategoryOut(BaseModel):
    key: str
    label: str
    description: str
    scenarios: list[ScenarioOut]


class CustomScenarioIn(BaseModel):
    user_id: str
    title: str
    #: Who the AI plays.
    ai_role: str
    #: Where the scene is and what is going on.
    setting: str
    ai_name: str | None = None
    personality: str | None = None
    #: Who the learner is in the scene.
    learner_role: str | None = None
    goal: str | None = None


class CustomScenarioOut(BaseModel):
    id: str
    title: str
    ai_name: str | None
    ai_role: str
    personality: str | None
    setting: str
    learner_role: str | None
    goal: str | None
    created_at: str


class ScenarioCatalogOut(BaseModel):
    categories: list[ScenarioCategoryOut]
    custom: list[CustomScenarioOut]


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
    # The exact text of each of those pieces, in order. The client needs this
    # to highlight words in time with the voice: it has to know which words
    # belong to the clip currently playing, and the split is decided here (by
    # the selected TTS engine) rather than by any rule the client could
    # reproduce. Empty for turns that are never spoken aloud.
    audio_chunks: list[str] = []
    stt_confidence: float | None
    created_at: str


class TargetWordOut(BaseModel):
    id: str
    word: str
    used_outcome: UsageOutcome | None  # None until end_session classifies it
    #: Why it was picked: "due", "new", "retry", "not said yet", "stretch",
    #: "fits scene", "again" (practise-again), joined with " · ".
    reason: str | None = None


class ConversationSessionOut(BaseModel):
    id: str
    user_id: str
    scenario: ScenarioKey
    #: What to call it — the catalog's name, or the title the learner gave.
    scenario_label: str = ""
    #: The character the learner talks to in this scene.
    persona_name: str = "Juno"
    persona_role: str = ""
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
    #: The learner's turns only; None in reports written before it was counted.
    learner_turns: int | None = None
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
    #: The cloud AI was switched off from the AI button: nothing is sent.
    llm_off: bool = False
