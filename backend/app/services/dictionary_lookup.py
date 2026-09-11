"""Live lookups against dictionaryapi.dev, for the manual "add word" flow.

This is the one place in the backend that makes an outbound network request
on the user's behalf — everything else in the app is offline-first by
design. It only ever fires on an explicit search the user typed, never
automatically, and a network failure is reported honestly (as "couldn't
reach the dictionary") rather than silently faking data.

dictionaryapi.dev is free but unofficial and occasionally flaky/down (seen
first-hand while building this — see backend/tests). If it's unreachable,
or it genuinely doesn't know the word, we fall back to freedictionaryapi.com
(also free, no key required) so one dictionary being down doesn't take the
whole feature with it. Only if *both* fail to find the word do we report
"not found"; only if *both* are unreachable do we raise
DictionaryServiceUnavailable.

Uses urllib from the standard library rather than adding an HTTP client
dependency for two endpoints (same "keep footprint reasonable" call as
utils/ids.py's vendored uuid7).
"""

import json
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass

API_BASE = "https://api.dictionaryapi.dev/api/v2/entries/en"
FALLBACK_API_BASE = "https://freedictionaryapi.com/api/v1/entries/en"
TIMEOUT_SECONDS = 6.0

# Both dictionaryapi.dev and freedictionaryapi.com 403 requests carrying
# urllib's default "Python-urllib/x.y" User-Agent (a common anti-bot
# heuristic) — a realistic one is required for either to actually respond.
_USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)


def _fetch_json(url: str, *, timeout: float) -> object:
    request = urllib.request.Request(url, headers={"User-Agent": _USER_AGENT})
    with urllib.request.urlopen(request, timeout=timeout) as res:  # noqa: S310 — fixed https host, not user input
        return json.loads(res.read().decode("utf-8"))


class DictionaryServiceUnavailable(Exception):
    """Network/DNS/timeout talking to dictionaryapi.dev — distinct from the
    API cleanly answering "this isn't a word" (see DictionaryResult.found)."""


@dataclass(frozen=True)
class DictionarySense:
    pos: str
    definition: str
    example: str | None


@dataclass(frozen=True)
class DictionaryResult:
    word: str
    found: bool
    ipa: str | None
    audio_url: str | None
    senses: tuple[DictionarySense, ...]
    synonyms: tuple[str, ...]


def search(word: str, *, timeout: float = TIMEOUT_SECONDS) -> DictionaryResult:
    """Look up a word, preferring dictionaryapi.dev and falling back to
    freedictionaryapi.com if the primary source is unreachable or draws a
    blank."""
    clean = word.strip()

    primary_error: DictionaryServiceUnavailable | None = None
    try:
        primary = _search_primary(clean, timeout=timeout)
        if primary.found:
            return primary
    except DictionaryServiceUnavailable as err:
        primary_error = err
        primary = None

    try:
        fallback = _search_fallback(clean, timeout=timeout)
    except DictionaryServiceUnavailable:
        # Both sources unreachable: surface the primary's error (it's the
        # one we'd normally rely on) rather than the fallback's.
        if primary_error is not None:
            raise primary_error
        raise

    if fallback.found:
        return fallback

    # Neither source knows the word. Prefer whichever result we actually
    # got back (it carries the clean/normalised word); if the primary
    # source was unreachable, the fallback's honest not-found stands in.
    return primary if primary is not None else fallback


def _search_primary(word: str, *, timeout: float = TIMEOUT_SECONDS) -> DictionaryResult:
    clean = word.strip()
    url = f"{API_BASE}/{urllib.parse.quote(clean)}"

    try:
        payload = _fetch_json(url, timeout=timeout)
    except urllib.error.HTTPError as err:
        if err.code == 404:
            return DictionaryResult(word=clean, found=False, ipa=None, audio_url=None, senses=(), synonyms=())
        raise DictionaryServiceUnavailable(f"dictionaryapi.dev returned {err.code}") from err
    except (urllib.error.URLError, TimeoutError, OSError) as err:
        raise DictionaryServiceUnavailable(str(err)) from err

    ipa: str | None = None
    audio_url: str | None = None
    senses: list[DictionarySense] = []
    synonyms: list[str] = []

    for entry in payload:
        if not ipa and entry.get("phonetic"):
            ipa = entry["phonetic"]
        for ph in entry.get("phonetics", []):
            if not ipa and ph.get("text"):
                ipa = ph["text"]
            if not audio_url and ph.get("audio"):
                audio_url = ph["audio"]

        for meaning in entry.get("meanings", []):
            pos = meaning.get("partOfSpeech", "")
            synonyms.extend(meaning.get("synonyms", []))
            for definition in meaning.get("definitions", []):
                text = definition.get("definition")
                if not text:
                    continue
                senses.append(DictionarySense(pos=pos, definition=text, example=definition.get("example")))
                synonyms.extend(definition.get("synonyms", []))

    # De-dupe synonyms (they're repeated across meanings/definitions) while
    # keeping first-seen order, same style as cefr_lexicon's own tuples.
    seen: set[str] = set()
    unique_synonyms: list[str] = []
    for s in synonyms:
        if s not in seen:
            seen.add(s)
            unique_synonyms.append(s)

    return DictionaryResult(
        word=clean,
        found=len(senses) > 0,
        ipa=ipa,
        audio_url=audio_url,
        senses=tuple(senses),
        synonyms=tuple(unique_synonyms),
    )


def _search_fallback(word: str, *, timeout: float = TIMEOUT_SECONDS) -> DictionaryResult:
    """Fallback source: freedictionaryapi.com. It answers "unknown word"
    with a 200 and an empty entries list rather than a 404, so found is
    keyed off that rather than the HTTP status."""
    clean = word.strip()
    url = f"{FALLBACK_API_BASE}/{urllib.parse.quote(clean)}"

    try:
        payload = _fetch_json(url, timeout=timeout)
    except urllib.error.HTTPError as err:
        if err.code == 404:
            return DictionaryResult(word=clean, found=False, ipa=None, audio_url=None, senses=(), synonyms=())
        raise DictionaryServiceUnavailable(f"freedictionaryapi.com returned {err.code}") from err
    except (urllib.error.URLError, TimeoutError, OSError) as err:
        raise DictionaryServiceUnavailable(str(err)) from err

    ipa: str | None = None
    senses: list[DictionarySense] = []
    synonyms: list[str] = []

    for entry in payload.get("entries", []):
        pos = entry.get("partOfSpeech", "")
        for pron in entry.get("pronunciations", []):
            if not ipa and pron.get("type") == "ipa" and pron.get("text"):
                ipa = pron["text"]

        for sense in entry.get("senses", []):
            text = sense.get("definition")
            if not text:
                continue
            examples = sense.get("examples") or []
            example = examples[0] if examples else None
            senses.append(DictionarySense(pos=pos, definition=text, example=example))
            synonyms.extend(sense.get("synonyms", []))

    seen: set[str] = set()
    unique_synonyms: list[str] = []
    for s in synonyms:
        if s not in seen:
            seen.add(s)
            unique_synonyms.append(s)

    return DictionaryResult(
        word=clean,
        found=len(senses) > 0,
        ipa=ipa,
        audio_url=None,
        senses=tuple(senses),
        synonyms=tuple(unique_synonyms),
    )
