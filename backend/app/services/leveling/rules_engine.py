"""Deterministic leveling: the `inline` and `lexical` modes (spec §7.3, D7).

No model, no network, no inference — a CEFR wordlist lookup and a phrase table.
Two properties matter more than cleverness here:

* **Byte-identical where nothing changed.** Only runs that were actually
  replaced differ from the source. A reader comparing the two versions should
  see exactly the words that moved, and nothing else.
* **Same input, same output, forever.** The cache in leveled_blocks is
  content-addressed and never invalidated, so a non-deterministic engine would
  make the first render permanent. Every decision below is a pure function of
  (text, target_cefr) and the two committed data files.
"""

import csv
import re
import threading
from dataclasses import dataclass
from pathlib import Path

from app.services import cefr_lexicon
from app.services.leveling.base import (
    RULES_MODES,
    EngineUnavailable,
    LeveledSegment,
    LeveledText,
    Mode,
)

ENGINE_NAME = "rules-v1"

_PHRASE_PATH = Path(__file__).resolve().parent.parent.parent / "data" / "phrase_simplifications.csv"


@dataclass(frozen=True)
class Phrase:
    phrase: str
    simpler: str
    cefr: str


_phrases: list[Phrase] | None = None
_phrase_lock = threading.Lock()


def _load_phrases() -> list[Phrase]:
    global _phrases
    if _phrases is not None:
        return _phrases

    with _phrase_lock:
        if _phrases is not None:  # another thread won the race
            return _phrases

        out: list[Phrase] = []
        with _PHRASE_PATH.open(encoding="utf-8-sig", newline="") as f:
            rows = (line for line in f if not line.startswith("#"))
            for row in csv.DictReader(rows):
                phrase = (row.get("phrase") or "").strip().lower()
                simpler = (row.get("simpler") or "").strip()
                cefr = (row.get("cefr") or "").strip().upper()
                if not phrase or not simpler or not cefr_lexicon.is_valid_band(cefr):
                    continue
                out.append(Phrase(phrase=phrase, simpler=simpler, cefr=cefr))

        # Longest first so "go through with" wins over "go through".
        out.sort(key=lambda p: len(p.phrase), reverse=True)
        _phrases = out
        return _phrases


def _match_case(original: str, replacement: str) -> str:
    """Carry the original's capitalisation across, so a sentence-initial
    substitution doesn't start the sentence in lower case."""
    if original.isupper() and len(original) > 1:
        return replacement.upper()
    if original[:1].isupper():
        return replacement[:1].upper() + replacement[1:]
    return replacement


def _merge(segments: list[LeveledSegment]) -> tuple[LeveledSegment, ...]:
    """Collapse adjacent untouched runs so the panel renders one span per
    stretch of unchanged prose rather than one per word."""
    merged: list[LeveledSegment] = []
    for seg in segments:
        if not seg.text:
            continue
        if seg.original is None and merged and merged[-1].original is None:
            merged[-1] = LeveledSegment(merged[-1].text + seg.text)
        else:
            merged.append(seg)
    return tuple(merged)


def _substitute_words(text: str, target_cefr: str) -> list[LeveledSegment]:
    """Replace only words rated above the target that have a simpler synonym.

    A word above level with no recorded synonym is deliberately left alone —
    inventing a replacement is exactly the kind of quiet wrongness that makes
    a learner distrust the whole feature.
    """
    segments: list[LeveledSegment] = []
    cursor = 0

    for match in cefr_lexicon.WORD_RE.finditer(text):
        word = match.group(0)
        if not cefr_lexicon.is_above_level(word, target_cefr):
            continue
        entry = cefr_lexicon.lookup(word)
        if entry is None or not entry.simpler:
            continue

        segments.append(LeveledSegment(text[cursor : match.start()]))
        segments.append(LeveledSegment(_match_case(word, entry.simpler), original=word))
        cursor = match.end()

    segments.append(LeveledSegment(text[cursor:]))
    return segments


def _substitute_phrases(text: str, target_cefr: str) -> list[LeveledSegment]:
    """Phrase pass, run before the word pass so a multi-word idiom is replaced
    as a unit instead of having one of its words swapped underneath it."""
    spans: list[tuple[int, int, str, str]] = []  # start, end, original, replacement
    taken = [False] * (len(text) + 1)

    for phrase in _load_phrases():
        if cefr_lexicon.rank(phrase.cefr) <= cefr_lexicon.rank(target_cefr):
            continue
        pattern = re.compile(r"\b" + re.escape(phrase.phrase).replace(r"\ ", r"\s+") + r"\b", re.I)
        for match in pattern.finditer(text):
            if any(taken[match.start() : match.end()]):
                continue  # a longer phrase already claimed this span
            for i in range(match.start(), match.end()):
                taken[i] = True
            spans.append((match.start(), match.end(), match.group(0), phrase.simpler))

    if not spans:
        return [LeveledSegment(text)]

    spans.sort()
    segments: list[LeveledSegment] = []
    cursor = 0
    for start, end, original, replacement in spans:
        segments.append(LeveledSegment(text[cursor:start]))
        segments.append(LeveledSegment(_match_case(original, replacement), original=original))
        cursor = end
    segments.append(LeveledSegment(text[cursor:]))
    return segments


class RulesEngine:
    name = ENGINE_NAME

    def supports(self, mode: Mode) -> bool:
        return mode in RULES_MODES

    def level(self, text: str, mode: Mode, target_cefr: str) -> LeveledText:
        if not self.supports(mode):
            raise EngineUnavailable(f"{mode} needs a language model")

        target = target_cefr.upper()

        if mode == "inline":
            segments = _substitute_words(text, target)
        else:
            # Lexical = phrases first, then words inside whatever the phrase
            # pass left untouched.
            segments = []
            for seg in _substitute_phrases(text, target):
                if seg.original is not None:
                    segments.append(seg)
                else:
                    segments.extend(_substitute_words(seg.text, target))

        merged = _merge(segments)
        replaced = sum(1 for s in merged if s.original is not None)
        return LeveledText(
            mode=mode,
            target_cefr=target,
            engine=self.name,
            original=text,
            segments=merged,
            available=True,
            note=None if replaced else "Nothing in this passage is above your level.",
        )


engine = RulesEngine()
