from pydantic import BaseModel, Field


class ReviewCardOut(BaseModel):
    vocab_word_id: str
    card_type: str
    word: str
    ipa: str | None = None
    pos: str | None = None
    cefr: str | None = None
    definition: str | None = None
    #: The word's other saved meanings, when it has more than one. The card
    #: is about `definition` — the meaning its sentence was saved under.
    other_senses: list[str] = []
    simpler: str | None = None
    example: str | None = None
    mnemonic: str | None = None
    synonyms: list[str] = []
    audio_url: str | None = None
    context_snippet: str | None = None
    context_source: str | None = None
    #: The clip for that context, when the word was saved from a film. Status
    #: is carried too: a clip can be queued, still extracting, or failed, and
    #: the card says which rather than offering a control that does nothing.
    clip_id: str | None = None
    clip_status: str | None = None
    #: The film it came from — null when it has since been removed from the
    #: library, which is what distinguishes "not cut yet" from "gone".
    media_item_id: str | None = None
    # Cloze cards only: the sentence either side of the blank.
    cloze_before: str | None = None
    cloze_after: str | None = None
    #: The word as it stands in that sentence — what to type into the gap.
    cloze_answer: str | None = None

    state: str
    stability_days: float
    difficulty: float
    reps: int
    lapses: int
    spontaneous_sessions: int
    mastery_level: int
    mastery_label: str
    mastery_reason: str
    is_leech: bool
    # What each button would schedule, already humanised ("10 m", "3.2 mo").
    intervals: dict[str, str]


class RateCardIn(BaseModel):
    user_id: str
    rating: int = Field(ge=1, le=4)


class RateCardOut(BaseModel):
    vocab_word_id: str
    state: str
    due: str | None
    stability_days: float
    difficulty: float
    reps: int
    lapses: int
    suspended: bool
    is_leech: bool
    mastery_level: int
    mastery_label: str
    mastery_reason: str
    interval_label: str
    #: Still in short steps, so it comes back in this sitting — the card as
    #: it now stands. None once it has a date.
    requeue: ReviewCardOut | None = None


class ForecastDay(BaseModel):
    date: str
    count: int


class ReviewStatsOut(BaseModel):
    due_now: int
    new_available: int
    total_cards: int
    suspended: int
    reviewed_today: int
    #: How many never-seen cards exist, of which `new_available` can still be
    #: introduced today under `new_per_day`.
    new_total: int = 0
    new_per_day: int = 15
    target_retention: float
    forecast: list[ForecastDay]
    # Cards at each mastery level 0-5 (spec §6.3).
    mastery_counts: list[int]


class UndoIn(BaseModel):
    user_id: str


class SuspendIn(BaseModel):
    user_id: str
    suspended: bool
