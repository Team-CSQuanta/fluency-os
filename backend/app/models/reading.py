from typing import Literal

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


PAGE_THEMES = ("auto", "light", "sepia", "dark")
PANEL_TABS = ("toc", "search", "marks", "text", "ai", "level")
PAGE_SCROLLS = ("vertical", "horizontal")
# Half the width of the window up to four times it. Below the floor the print
# is too small to read and the reader would have no way of knowing why;
# above the ceiling a single page is larger than most screens can show at all.
PAGE_ZOOM_MIN = 0.5
PAGE_ZOOM_MAX = 4.0


class ReaderPrefsOut(BaseModel):
    font_size: float
    page_theme: str
    heat_on: bool
    panel_open: bool
    panel_tab: str
    # Whether a PDF opens showing its own typeset page beside the text.
    # Defaulted so that a settings row written before this existed still
    # validates rather than 500-ing the whole reader.
    page_view: bool = False
    # Whether those pages run down the screen or across it.
    page_scroll: str = "vertical"
    # A multiple of the width that fits the window, not a percentage of a
    # fixed size — see the migration.
    page_zoom: float = 1.0


class ReaderPrefsUpdate(BaseModel):
    user_id: str
    # Bounds match the A−/A+ buttons; the server is the one that has to hold
    # the line, since a stored 400px font would make the reader unusable.
    font_size: float = Field(ge=12, le=22)
    page_theme: Literal["auto", "light", "sepia", "dark"]
    heat_on: bool
    panel_open: bool
    # The panel was grouped into four tabs; "text", "ai" and "level" were
    # folded into them. Old values are still read back out of settings rows
    # written before that, and the client maps them forward — only what it
    # writes is constrained here.
    panel_tab: Literal["toc", "search", "marks", "study"]
    page_view: bool = False
    page_scroll: Literal["vertical", "horizontal"] = "vertical"
    page_zoom: float = Field(default=1.0, ge=PAGE_ZOOM_MIN, le=PAGE_ZOOM_MAX)


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


class LevelTextRequest(BaseModel):
    """Simplify a passage the reader selected, rather than a stored block.

    The block-based request above can only reach text the extractor found and
    recorded. A selection on the printed page is an arbitrary run of words —
    it may cross blocks, or cover a caption or an equation the extractor
    dropped entirely — so it arrives as text.
    """

    text: str
    mode: str
    target_cefr: str | None = None
    user_id: str | None = None
    # Set by the reader's page labels, which write the result OVER the printed
    # words. Degrading to a wordlist substitution is right for the side panel,
    # which shows its result next to the original and says what it is — but a
    # label covers the text it replaces, so one that says nothing new is worse
    # than none. With this set, no model means no label and a plain answer.
    require_model: bool = False
