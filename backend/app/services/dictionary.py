"""Where a word's meaning comes from, and in what order.

Three sources, cheapest first, because the expensive one is expensive enough
to notice: an online lookup is a round trip of a second or three, and it was
being paid on every single search — including for a word looked up a minute
earlier.

    1. the bundled lexicon   no I/O at all, a few hundred words with
                             definitions, and the only source that knows a
                             CEFR band or a simpler synonym
    2. the local cache       every word any online dictionary has answered
                             for on this machine, kept in SQLite
    3. the online dictionaries

Anything found online is written to the cache on the way back, so a word is
slow exactly once. The cache is disposable: delete the table and it refills.

Misses are deliberately NOT cached. Storing "this is not a word" would freeze
a dictionary's gap in place — including the gaps that appear when the network
is flaky — and a genuine miss is rare enough that looking again costs little.
"""

import json
import sqlite3
from dataclasses import dataclass

from app.services import cefr_lexicon, dictionary_lookup
from app.services.dictionary_lookup import DictionaryResult, DictionarySense
from app.utils.time import iso8601_utc_now

# Re-exported so callers can catch it without importing the transport module.
DictionaryServiceUnavailable = dictionary_lookup.DictionaryServiceUnavailable

Source = str  # 'lexicon' | 'cache' | the name of the online dictionary


@dataclass(frozen=True)
class Answer:
    result: DictionaryResult
    #: Which of the three layers answered. Carried so callers can say whether
    #: a definition came from the machine or from the network.
    source: Source


def _key(word: str) -> str:
    return word.strip().lower()


def _from_lexicon(word: str) -> DictionaryResult | None:
    """The bundled list, but only when it actually has a definition.

    Two thirds of its rows carry a CEFR band and nothing else. Those are
    worth having — they are what the difficulty overlay runs on — but they
    are not an answer to "what does this mean", and returning one as if it
    were would replace a real definition with silence."""
    entry = cefr_lexicon.lookup(word)
    if entry is None or not entry.definition:
        return None
    return DictionaryResult(
        word=entry.lemma or word,
        found=True,
        ipa=None,
        audio_url=None,
        senses=(DictionarySense(pos=entry.pos or "", definition=entry.definition, example=entry.example),),
        synonyms=tuple(entry.synonyms),
    )


def cached(conn: sqlite3.Connection, word: str) -> DictionaryResult | None:
    row = conn.execute("SELECT * FROM dictionary_entries WHERE word = ?", (_key(word),)).fetchone()
    if row is None:
        return None
    try:
        senses = tuple(
            DictionarySense(
                pos=s.get("pos", ""), definition=s.get("definition", ""), example=s.get("example")
            )
            for s in json.loads(row["senses"])
        )
        synonyms = tuple(json.loads(row["synonyms"]))
    except (json.JSONDecodeError, AttributeError, TypeError):
        # A row we can no longer read is a cache problem, not a user problem:
        # drop it and let the lookup fall through to the network.
        conn.execute("DELETE FROM dictionary_entries WHERE word = ?", (_key(word),))
        return None
    return DictionaryResult(
        word=row["display"],
        found=True,
        ipa=row["ipa"],
        audio_url=row["audio_url"],
        senses=senses,
        synonyms=synonyms,
    )


def remember(conn: sqlite3.Connection, word: str, result: DictionaryResult, *, source: Source) -> None:
    """Keep what the network said. Never called for a miss."""
    if not result.found or not result.senses:
        return
    conn.execute(
        """
        INSERT INTO dictionary_entries (word, display, ipa, audio_url, senses, synonyms, source, cached_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(word) DO UPDATE SET
          display = excluded.display, ipa = excluded.ipa, audio_url = excluded.audio_url,
          senses = excluded.senses, synonyms = excluded.synonyms,
          source = excluded.source, cached_at = excluded.cached_at
        """,
        (
            _key(word),
            result.word,
            result.ipa,
            result.audio_url,
            json.dumps([{"pos": s.pos, "definition": s.definition, "example": s.example} for s in result.senses]),
            json.dumps(list(result.synonyms)),
            source,
            iso8601_utc_now(),
        ),
    )


def look_up(
    conn: sqlite3.Connection,
    word: str,
    *,
    allow_network: bool = True,
    timeout: float = dictionary_lookup.TIMEOUT_SECONDS,
) -> Answer:
    """A word's meaning, from the nearest source that has one.

    `allow_network=False` answers from this machine alone and reports a miss
    rather than reaching out — for callers that must not block on a network
    they may not have.

    Raises DictionaryServiceUnavailable only when the network was the last
    resort AND it could not be reached, never when a local layer answered.
    """
    clean = word.strip()
    if not clean:
        return Answer(
            DictionaryResult(word=word, found=False, ipa=None, audio_url=None, senses=(), synonyms=()),
            source="lexicon",
        )

    local = _from_lexicon(clean)
    if local is not None:
        return Answer(local, source="lexicon")

    hit = cached(conn, clean)
    if hit is not None:
        return Answer(hit, source="cache")

    if not allow_network:
        return Answer(
            DictionaryResult(word=clean, found=False, ipa=None, audio_url=None, senses=(), synonyms=()),
            source="lexicon",
        )

    result = dictionary_lookup.search(clean, timeout=timeout)
    remember(conn, clean, result, source="online")
    return Answer(result, source="online")
