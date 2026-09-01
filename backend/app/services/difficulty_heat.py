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
