"""Difficulty heat: which character ranges in a block are above the reader's
level (spec Phase 6).

Pure functions over text — no database, no model. Character *spans* are
returned rather than a list of words, because the reader tints in place
inside the paragraph it already renders: it needs to know exactly which
characters to wrap, and word positions are the only thing that survives a
font change or a re-wrap.

Spans are computed against the block's raw text, so the offsets line up with
the same coordinates highlights use (spec §7.2).
"""

from collections.abc import Sequence
from dataclasses import dataclass

from app.services import cefr_lexicon


@dataclass(frozen=True)
class HeatSpan:
    start_char: int
    end_char: int
    word: str
    cefr: str
    simpler: str | None


def spans_for_text(text: str, target_cefr: str) -> list[HeatSpan]:
    """Every above-level word in `text`, as character ranges in document
    order. Repeats are all returned: the reader tints each occurrence."""
    if not text or not cefr_lexicon.is_valid_band(target_cefr):
        return []

    target_rank = cefr_lexicon.rank(target_cefr)
    out: list[HeatSpan] = []

    for match in cefr_lexicon.WORD_RE.finditer(text):
        surface = match.group(0)
        entry = cefr_lexicon.lookup(surface)
        if entry is None or cefr_lexicon.rank(entry.cefr) <= target_rank:
            continue
        out.append(
            HeatSpan(
                start_char=match.start(),
                end_char=match.end(),
                word=surface,
                cefr=entry.cefr,
                simpler=entry.simpler,
            )
        )

    return out


def count_above_level(text: str, target_cefr: str) -> int:
    """How many above-level words a stretch of text contains — the number
    behind the Text panel's "N words above B2" line."""
    return len(spans_for_text(text, target_cefr))


def distinct_above_level(text: str, target_cefr: str) -> list[str]:
    """The distinct lemmas above level, in first-appearance order. Useful for
    a vocabulary suggestion, where ten copies of one word are still one word."""
    seen: dict[str, None] = {}
    for span in spans_for_text(text, target_cefr):
        entry = cefr_lexicon.lookup(span.word)
        lemma = entry.lemma if entry else cefr_lexicon.normalise(span.word)
        seen.setdefault(lemma, None)
    return list(seen)


@dataclass(frozen=True)
class WordHeat:
    """One boxed word on a printed page that is above the reader's level."""

    index: int
    word: str
    cefr: str
    simpler: str | None


def above_level_boxes(words: Sequence[str], target_cefr: str) -> list[WordHeat]:
    """Which of a printed page's boxed words are above level.

    The reflowed view tints character ranges inside a paragraph it lays out
    itself. A printed page has no character offsets to tint — it has boxes,
    one per whitespace-separated token of the PDF's own text layer, and the
    tint is drawn over the box. So difficulty is answered per box here.

    A box carries whatever punctuation was attached to it ("vision,", "—the")
    and occasionally more than one lexical word, so a box counts as above
    level when anything inside it is, and reports the hardest thing it holds:
    tinting a box is a promise that there is something hard in it, and the
    reader should be told which word that is.
    """
    if not cefr_lexicon.is_valid_band(target_cefr):
        return []

    out: list[WordHeat] = []
    for index, box in enumerate(words):
        hardest: HeatSpan | None = None
        for span in spans_for_text(box, target_cefr):
            if hardest is None or cefr_lexicon.rank(span.cefr) > cefr_lexicon.rank(hardest.cefr):
                hardest = span
        if hardest is not None:
            out.append(
                WordHeat(index=index, word=hardest.word, cefr=hardest.cefr, simpler=hardest.simpler)
            )
    return out
