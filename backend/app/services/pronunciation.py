"""Offline IPA lookup.

WordNet has definitions but no phonetics, and until now the only source of
IPA in this app was dictionaryapi.dev — so a word the online dictionary had
never heard of, or any word saved while offline, simply had no pronunciation
shown. This closes that gap with CMUdict's 126k words, converted once at
build time (see data/pronunciations.csv and services/arpabet.py).

Loaded lazily and kept in memory: 126k short strings is a few MB, and the
alternative — a lookup per word against a file on disk — would be slower for
no saving worth having on a machine already holding a language model.
"""

import csv
import threading
from functools import lru_cache
from pathlib import Path

from app.services import cefr_lexicon

_PATH = Path(__file__).resolve().parent.parent / "data" / "pronunciations.csv"

_table: dict[str, str] | None = None
_lock = threading.Lock()


def _load() -> dict[str, str]:
    global _table
    if _table is not None:
        return _table
    with _lock:
        if _table is not None:
            return _table
        table: dict[str, str] = {}
        if _PATH.exists():
            with _PATH.open(encoding="utf-8") as f:
                for row in csv.reader(line for line in f if not line.startswith("#")):
                    if len(row) >= 2 and row[0] != "word":
                        table[row[0]] = row[1]
        _table = table
        return _table


@lru_cache(maxsize=4096)
def ipa_for(word: str) -> str | None:
    """IPA for a word, without the enclosing slashes, or None if unknown.

    Tries the surface form first and only then the lemma: "leaves" is in the
    dictionary with its own pronunciation, and falling straight back to
    "leave" would show the wrong one. The lemma is the fallback for the
    inflections CMUdict happens not to list."""
    table = _load()
    surface = cefr_lexicon.normalise(word or "")
    if not surface:
        return None
    direct = table.get(surface)
    if direct:
        return direct
    for candidate in cefr_lexicon.base_forms(surface):
        found = table.get(candidate)
        if found:
            return found
    return None


def size() -> int:
    return len(_load())


def display(value: str | None) -> str | None:
    """One consistent written form, whatever the source.

    dictionaryapi.dev returns IPA already wrapped in slashes ("/ˈwʌndə/")
    and CMUdict-derived IPA has none, so a list mixing the two rendered some
    entries with delimiters and some without. Normalised here rather than in
    the UI because both values arrive through the same field."""
    if not value:
        return None
    stripped = value.strip().strip("/").strip()
    return f"/{stripped}/" if stripped else None
