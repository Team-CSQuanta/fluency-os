from pydantic import BaseModel, Field


class GoalDayOut(BaseModel):
    date: str
    label: str
    pages: int
    # 0-100, clamped — drives the week bar heights so the client never has to
    # know the goal to draw them.
    percent: int


class ReadingStatsOut(BaseModel):
    goal_pages: int
    pages_today: int
    books_today: int
    streak_days: int
    goal_met: bool
    week: list[GoalDayOut]


class GoalUpdate(BaseModel):
    user_id: str
    daily_page_goal: int = Field(ge=1, le=500)


class LeveledSegmentOut(BaseModel):
    text: str
    # Null for untouched prose; the replaced wording otherwise, which is what
    # the panel underlines and lists in its substitution ledger.
    original: str | None


class SubstitutionOut(BaseModel):
    from_text: str
    to_text: str


class LeveledTextOut(BaseModel):
    mode: str
    target_cefr: str
    engine: str
    original: str
    segments: list[LeveledSegmentOut]
    substitutions: list[SubstitutionOut]
    # False when the mode needs a model and none is configured. Always a 200 —
    # being offline is the app's normal state, not an error.
    available: bool
    note: str | None
    cached: bool
    # Set when the requested mode couldn't run and a simpler one was returned
    # instead, so the panel can say what it actually showed.
    served_mode: str


class LevelRequest(BaseModel):
    book_id: str
    block_index: int
    mode: str
    target_cefr: str | None = None
    user_id: str | None = None


class SessionOut(BaseModel):
    id: str
    book_id: str
    local_date: str
    words_read: int
    seconds: int


class SessionOpen(BaseModel):
    user_id: str


class SessionHeartbeat(BaseModel):
    seconds: int = Field(ge=0, le=3600)


class HeatSpanOut(BaseModel):
    start_char: int
    end_char: int
    word: str
    cefr: str
    simpler: str | None


class BlockHeatOut(BaseModel):
    block_index: int
    spans: list[HeatSpanOut]


class HeatOut(BaseModel):
    target_cefr: str
    # False when the book's own heat_overlay flag is off — the reader then
    # renders plain text without asking again per block window.
    enabled: bool
    blocks: list[BlockHeatOut]
    total_above_level: int


class WordSenseOut(BaseModel):
    definition: str
    example: str | None


class WordLookupOut(BaseModel):
    word: str
    lemma: str | None
    pos: str | None
    cefr: str | None
    ipa: str | None
    senses: list[WordSenseOut]
    synonyms: list[str]
    simpler: str | None
    # False when the word isn't in the offline lexicon at all, so the panel
    # can say so rather than rendering a convincing-looking empty entry.
    found: bool
    # An explanation of the word *as used in this sentence* needs generation.
    # Always False until a model is configured (Phase 7) — the panel keeps
    # its honest "offline stub" copy for that section only.
    context_available: bool
    context_note: str | None
