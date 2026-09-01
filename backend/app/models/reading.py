from pydantic import BaseModel


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
