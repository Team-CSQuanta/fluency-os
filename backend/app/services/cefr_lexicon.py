"""CEFR lexicon: what band is this word, and is it above the reader's level?

Backs the difficulty heat overlay and the reader's word-lookup panel, both of
which run entirely offline with no model (spec Phase 6).

Two design notes worth keeping in mind:

* **Lemmatisation is rule-based, not a library.** Pulling in NLTK or spaCy for
  this would add tens of megabytes and a model download to an offline-first
  app whose whole point is running on a 6 GB machine. Suffix stripping with a
  dictionary check is far cruder in theory but nearly as good in practice,
  because a candidate form is only accepted if it's actually in the lexicon.
* **Unknown words are unrated, never "above level".** A word missing from the
  list simply doesn't tint. The alternative — treating unknown as hard —
  would light up every proper noun on the page.
"""

import csv
import re
import threading
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

CEFR_ORDER = ("A1", "A2", "B1", "B2", "C1", "C2")
_CEFR_RANK = {band: i for i, band in enumerate(CEFR_ORDER)}

_WORDLIST_PATH = Path(__file__).resolve().parent.parent / "data" / "cefr_wordlist.csv"

# Letters, plus the internal apostrophes and hyphens that belong to a word
# ("didn't", "self-aware"). Used to walk prose one word at a time.
WORD_RE = re.compile(r"[A-Za-z][A-Za-z'’\-]*")

_VOWELS = set("aeiou")


@dataclass(frozen=True)
class LexiconEntry:
    lemma: str
    cefr: str
    pos: str
    simpler: str | None
    definition: str | None
    example: str | None
    synonyms: tuple[str, ...]


_lexicon: dict[str, LexiconEntry] | None = None
_load_lock = threading.Lock()


def _load() -> dict[str, LexiconEntry]:
    global _lexicon
    if _lexicon is not None:
        return _lexicon

    with _load_lock:
        if _lexicon is not None:  # another thread won the race
            return _lexicon

        entries: dict[str, LexiconEntry] = {}
        with _WORDLIST_PATH.open(encoding="utf-8-sig", newline="") as f:
            rows = (line for line in f if not line.startswith("#"))
            for row in csv.DictReader(rows):
                lemma = (row.get("lemma") or "").strip().lower()
                cefr = (row.get("cefr") or "").strip().upper()
                if not lemma or cefr not in _CEFR_RANK:
                    continue
                synonyms = tuple(
                    s.strip() for s in (row.get("synonyms") or "").split("|") if s.strip()
                )
                entries[lemma] = LexiconEntry(
                    lemma=lemma,
                    cefr=cefr,
                    pos=(row.get("pos") or "").strip(),
                    simpler=(row.get("simpler") or "").strip() or None,
                    definition=(row.get("definition") or "").strip() or None,
                    example=(row.get("example") or "").strip() or None,
                    synonyms=synonyms,
                )
        _lexicon = entries
        return _lexicon


def normalise(word: str) -> str:
    """Lowercase and strip the punctuation that clings to a word in prose."""
    return word.strip().strip("'’-").lower().replace("’", "'")


def _candidates(word: str) -> list[str]:
    """Progressively cruder base forms to try against the lexicon, most
    plausible first. Every candidate is dictionary-checked by the caller, so
    an over-eager rule costs nothing unless it happens to produce a real word."""
    out = [word]

    if word.endswith("'s") or word.endswith("s'"):
        out.append(word[:-2])

    if word.endswith("ies") and len(word) > 4:
        out.append(word[:-3] + "y")
    if word.endswith("es") and len(word) > 3:
        out.append(word[:-2])
    if word.endswith("s") and not word.endswith("ss") and len(word) > 3:
        out.append(word[:-1])

    if word.endswith("ied") and len(word) > 4:
        out.append(word[:-3] + "y")
    if word.endswith("ed") and len(word) > 3:
        out.append(word[:-2])          # walked -> walk
        out.append(word[:-1])          # moved  -> move
        if len(word) > 4 and word[-3] == word[-4] and word[-3] not in _VOWELS:
            out.append(word[:-3])      # stopped -> stop

    if word.endswith("ing") and len(word) > 4:
        out.append(word[:-3])          # walking -> walk
        out.append(word[:-3] + "e")    # moving  -> move
        if len(word) > 5 and word[-4] == word[-5] and word[-4] not in _VOWELS:
            out.append(word[:-4])      # running -> run

    if word.endswith("ly") and len(word) > 3:
        out.append(word[:-2])          # quickly -> quick
        if word.endswith("ily") and len(word) > 4:
            out.append(word[:-3] + "y")  # easily -> easy

    if word.endswith("est") and len(word) > 4:
        out.append(word[:-3])
        out.append(word[:-2])
    if word.endswith("er") and len(word) > 3:
        out.append(word[:-2])
        out.append(word[:-1])

    return out


@lru_cache(maxsize=8192)
def lookup(word: str) -> LexiconEntry | None:
    """The lexicon entry for a surface form, via its lemma. Cached because a
    page of prose asks about the same function words over and over."""
    lex = _load()
    base = normalise(word)
    if not base:
        return None
    for candidate in _candidates(base):
        entry = lex.get(candidate)
        if entry is not None:
            return entry
    return None


def band_of(word: str) -> str | None:
    """The CEFR band for a word, or None when it isn't in the lexicon."""
    entry = lookup(word)
    return entry.cefr if entry else None


def rank(band: str) -> int:
    return _CEFR_RANK.get(band.upper(), -1)


def is_valid_band(band: str) -> bool:
    return band.upper() in _CEFR_RANK


def is_above_level(word: str, target_cefr: str) -> bool:
    """True only when the word is *known* and rated harder than the target.
    An unrated word is never above level — see the module docstring."""
    band = band_of(word)
    if band is None:
        return False
    return rank(band) > rank(target_cefr)


def size() -> int:
    return len(_load())
