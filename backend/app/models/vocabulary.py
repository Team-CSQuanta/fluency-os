from typing import Literal

from pydantic import BaseModel

ContextKind = Literal["clip", "page", "turn"]


class VocabWordCreate(BaseModel):
    user_id: str
    word: str
    sentence: str | None = None
    book_id: str | None = None
    block_index: int | None = None


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
    created_at: str


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
    created_at: str


class VocabWordDetailOut(VocabWordOut):
    contexts: list[VocabContextOut]
    notes: list[VocabNoteOut]
    # Real per-outcome usage counts from Conversation sessions (review_logs) —
    # the visible half of Dynamic SRS Routing. Empty until Conversation exists.
    conversation_usage: dict[str, int]


class VocabWordSaveOut(BaseModel):
    word: VocabWordOut
    already_saved: bool


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
