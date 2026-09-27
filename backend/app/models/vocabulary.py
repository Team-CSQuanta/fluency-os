from typing import Literal

from pydantic import BaseModel

ContextKind = Literal["clip", "page", "turn"]


class VocabSenseIn(BaseModel):
    """The meaning the learner picked for the sentence they are saving."""

    pos: str | None = None
    definition: str
    example: str | None = None


class VocabSenseOut(BaseModel):
    id: str
    pos: str | None
    definition: str
    example: str | None
    created_at: str


class VocabWordCreate(BaseModel):
    user_id: str
    word: str
    sentence: str | None = None
    book_id: str | None = None
    block_index: int | None = None
    #: The printed page it was met on. A lookup on a page image has no block
    #: to point at, so without this the word is saved with no source at all.
    page: int | None = None
    #: Which meaning this sentence uses. Without it, the dictionary's first.
    sense: VocabSenseIn | None = None


class VocabNoteCreate(BaseModel):
    text: str


class VocabNoteOut(BaseModel):
    id: str
    text: str
    created_at: str


class VocabTagCreate(BaseModel):
    tag: str


class VocabContextOut(BaseModel):
    id: str
    kind: ContextKind
    snippet: str
    source_label: str
    book_id: str | None
    block_index: int | None
    #: The printed page, when the book has one.
    page: int | None = None
    #: Which of the entry's meanings this context illustrates.
    sense_id: str | None = None
    created_at: str
    # Where in which video this was captured (kind == 'clip'), so the entry
    # page can replay the moment rather than only quoting the line.
    media_item_id: str | None = None
    start_ms: int | None = None
    end_ms: int | None = None
    clip_id: str | None = None
    clip_status: str | None = None


class VocabWordOut(BaseModel):
    id: str
    user_id: str
    word: str
    lemma: str
    pos: str | None
    cefr: str | None
    definition: str | None
    example: str | None
    simpler: str | None
    ipa: str | None
    audio_url: str | None
    synonyms: list[str]
    tags: list[str]
    context_count: int
    ai_mnemonic: str | None
    ai_definition: str | None = None
    ai_examples: list[str] = []
    ai_usage_note: str | None = None
    ai_sense_definition: str | None = None
    #: Every meaning saved for this word, first-saved first. `definition`
    #: above is the first of them.
    senses: list[VocabSenseOut] = []
    created_at: str
    # Scheduling state, joined from review_cards. The most informative thing
    # about a saved word is where it stands — due, sticking, or a leech — and
    # the list had no access to it at all before.
    card_state: str | None = None
    due: str | None = None
    stability_days: float | None = None
    difficulty: float | None = None
    reps: int = 0
    lapses: int = 0
    suspended: bool = False
    mastery_level: int = 0
    mastery_label: str = "unseen"


class VocabWordDetailOut(VocabWordOut):
    contexts: list[VocabContextOut]
    notes: list[VocabNoteOut]
    # Real per-outcome usage counts from Conversation sessions (review_logs) —
    # the visible half of Dynamic SRS Routing. Empty until Conversation exists.
    conversation_usage: dict[str, int]
    # How this word has been answered on flashcards, kept apart from the
    # conversation counts above because they are different kinds of evidence
    # (spec §6.3) and merging them was a real bug.
    flashcard_reviews: dict[str, int]


class VocabCheckIn(BaseModel):
    user_id: str
    word: str
    #: The meanings on screen, in order — each is reported as known or not.
    definitions: list[str] = []


class VocabCheckOut(BaseModel):
    """Whether a word is already saved, and which of these meanings it has."""

    saved: bool
    vocab_word_id: str | None
    word: str | None
    sense_count: int
    context_count: int
    known: list[bool]


class VocabWordSaveOut(BaseModel):
    word: VocabWordOut
    already_saved: bool
    #: The entry existed, and this save gave it a meaning it did not have.
    sense_added: bool = False
    #: The sentence was recorded (false when it was already there).
    context_added: bool = False


class DictionarySenseOut(BaseModel):
    pos: str
    definition: str
    example: str | None


class DictionarySearchOut(BaseModel):
    word: str
    found: bool
    ipa: str | None
    audio_url: str | None
    senses: list[DictionarySenseOut]
    synonyms: list[str]
    # From our own offline lexicon, when it happens to also know the word —
    # dictionaryapi.dev has no CEFR data, so these are never invented.
    cefr: str | None
    simpler: str | None


class VocabWordManualCreate(BaseModel):
    user_id: str
    word: str
    pos: str
    definition: str
    example: str | None = None
    synonyms: list[str] = []
    ipa: str | None = None
    audio_url: str | None = None
    note: str | None = None
    # AI enrichment, kept apart from the dictionary's own fields above so
    # neither overwrites the other.
    ai_definition: str | None = None
    ai_examples: list[str] = []
    ai_mnemonic: str | None = None
    ai_usage_note: str | None = None
    # The dictionary sense the enrichment was generated against, so the entry
    # page can say which of a word's meanings it describes.
    ai_sense_definition: str | None = None


class AiExplainIn(BaseModel):
    user_id: str
    word: str
    context: str


class AiExplainOut(BaseModel):
    word: str
    pos: str
    definition: str
    example: str
    synonyms: list[str]


class AiExamplesOut(BaseModel):
    examples: list[str]


class AiMnemonicOut(BaseModel):
    mnemonic: str


class AiPracticeOut(BaseModel):
    question: str


class TagCountOut(BaseModel):
    tag: str
    count: int


class VocabOverviewOut(BaseModel):
    total: int
    added_last_7_days: int
    due_now: int
    new_count: int
    learning: int
    struggling: int
    suspended: int
    by_cefr: dict[str, int]
    tags: list[TagCountOut]


class AiEnrichIn(BaseModel):
    user_id: str
    word: str
    # Both optional: a word can be added from nothing but itself, and the
    # dictionary definition is grounding that keeps the model from inventing
    # a sense the word does not have.
    dictionary_definition: str | None = None
    context: str | None = None


class AiEnrichOut(BaseModel):
    definition: str
    examples: list[str]
    mnemonic: str
    usage_note: str
    synonyms: list[str]


class DictionaryCacheOut(BaseModel):
    """The local dictionary cache, as the settings page reports it."""

    entries: int
    #: None when nothing has been cached yet — a fresh install, or just cleared.
    last_cached_at: str | None
