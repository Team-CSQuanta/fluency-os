"""The vocabulary people reach for when describing a scene.

Mined from VATEX (Wang et al., ICCV 2019, CC BY 4.0): 30,000 human
descriptions of 3,000 clips, counted and filtered to words our CEFR table can
rate. See app/data/scene_vocabulary.csv.

Why a corpus rather than asking the model: a hint has to be a word that would
actually help, and the only honest source for "what words do people use to
describe what they saw" is a pile of people describing what they saw.
"""

import csv
import sqlite3
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from app.services import cefr_lexicon

_PATH = Path(__file__).resolve().parent.parent / "data" / "scene_vocabulary.csv"

# CEFR bands in order, so "near the learner's level" is a window rather than an
# exact match — a B1 learner is served by A2 words they may not have met and by
# B2 words just above them, and served nothing at all by C2.
_ORDER = ["A1", "A2", "B1", "B2", "C1", "C2"]


@dataclass(frozen=True)
class SceneWord:
    word: str
    cefr: str
    frequency: int


@lru_cache(maxsize=1)
def _load() -> tuple[SceneWord, ...]:
    if not _PATH.is_file():
        return ()
    rows: list[SceneWord] = []
    with _PATH.open(encoding="utf-8") as fh:
        for line in fh:
            if line.startswith("#"):
                continue
            for record in csv.DictReader([line] if rows else [line], fieldnames=["word", "cefr", "frequency"]):
                if record["word"] == "word":
                    continue
                try:
                    rows.append(
                        SceneWord(record["word"], record["cefr"], int(record["frequency"]))
                    )
                except (TypeError, ValueError):
                    continue
    return tuple(rows)


def size() -> int:
    return len(_load())


def band_window(level: str | None) -> set[str]:
    """The bands worth offering to a learner at `level`: their own, one below,
    one above. A hint far below their level is not a hint."""
    if level not in _ORDER:
        return {"A1", "A2", "B1"}
    index = _ORDER.index(level)
    return {_ORDER[i] for i in range(max(0, index - 1), min(len(_ORDER), index + 2))}


def suggest(
    conn: sqlite3.Connection,
    *,
    user_id: str,
    level: str | None,
    exclude: set[str],
    limit: int = 8,
) -> list[dict]:
    """Words that would help describe a scene, at roughly the learner's level.

    Marks which ones the learner has already saved, because those two cases
    want different things from the interface: a known word is a reminder, an
    unknown one is an offer.

    No meanings are attached here. The bundled lexicon can define 2 of these
    1,399 words — they are rated by the CEFR band table, which carries levels
    and not definitions — so a gloss would be absent almost every time. The
    interface instead looks a word up on demand through the dictionary path
    the add-word flow already uses, which also gives the learner the existing
    one-click way to keep it.
    """
    known = {
        row["lemma"]
        for row in conn.execute("SELECT lemma FROM vocab_words WHERE user_id = ?", (user_id,)).fetchall()
    }
    wanted = band_window(level)
    skip = {w.lower() for w in exclude}

    out: list[dict] = []
    for entry in _load():
        if entry.cefr not in wanted or entry.word in skip:
            continue
        lemma = cefr_lexicon.normalise(entry.word)
        is_known = lemma in known or entry.word in known
        out.append({"word": entry.word, "cefr": entry.cefr, "known": is_known})
        if len(out) >= limit:
            break
    return out
