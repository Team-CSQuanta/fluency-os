"""Manual "add word" flow: search dictionaryapi.dev, then save a chosen
sense. dictionary_lookup.search() itself is mocked everywhere here — these
tests must never depend on a real network call succeeding.
"""

import urllib.error

import pytest

from app.services import dictionary_lookup
from app.services.dictionary_lookup import DictionaryResult, DictionarySense, DictionaryServiceUnavailable

KNOWN_WORD = "abandon"  # in the bundled offline lexicon too — proves the cefr/simpler merge
# In the wider band table but NOT the curated lexicon, so it is the online
# dictionaries that have to answer for it.
ONLINE_WORD = "abolish"
UNKNOWN_LOCAL_WORD = "yeet"  # plausible modern word, not in the small bundled CEFR list


class _FakeHTTPResponse:
    def __init__(self, body: str):
        self._body = body.encode("utf-8")

    def read(self) -> bytes:
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


ABANDON_PAYLOAD = """
[
  {
    "word": "abandon",
    "phonetic": "/əˈbændən/",
    "phonetics": [
      {"text": "/əˈbændən/", "audio": "https://api.dictionaryapi.dev/media/pronunciations/en/abandon-us.mp3"}
    ],
    "meanings": [
      {
        "partOfSpeech": "verb",
        "definitions": [
          {"definition": "To leave; to depart from.", "example": "They had to abandon the car in the snow.", "synonyms": ["desert", "forsake"], "antonyms": []},
          {"definition": "To give up control of something.", "synonyms": [], "antonyms": []}
        ],
        "synonyms": ["desert", "leave"],
        "antonyms": []
      },
      {
        "partOfSpeech": "noun",
        "definitions": [
          {"definition": "Complete freedom from inhibition.", "synonyms": [], "antonyms": []}
        ],
        "synonyms": [],
        "antonyms": []
      }
    ]
  }
]
"""


# ---------------------------------------------------------------- dictionary_lookup.search()


def test_search_parses_senses_ipa_audio_and_dedupes_synonyms(monkeypatch):
    monkeypatch.setattr(
        dictionary_lookup.urllib.request, "urlopen", lambda url, timeout=None: _FakeHTTPResponse(ABANDON_PAYLOAD)
    )
    result = dictionary_lookup.search("abandon")

    assert result.found is True
    assert result.ipa == "/əˈbændən/"
    assert result.audio_url == "https://api.dictionaryapi.dev/media/pronunciations/en/abandon-us.mp3"
    assert len(result.senses) == 3
    assert result.senses[0].pos == "verb"
    assert result.senses[0].example == "They had to abandon the car in the snow."
    assert result.senses[1].example is None
    assert result.senses[2].pos == "noun"
    # "desert" appears in both a meaning-level and definition-level synonyms list — deduped, order kept
    assert result.synonyms.count("desert") == 1
    assert result.synonyms[0] == "desert"


def test_search_404_returns_found_false_not_an_exception(monkeypatch):
    def _raise(url, timeout=None):
        raise urllib.error.HTTPError(url, 404, "Not Found", hdrs=None, fp=None)

    monkeypatch.setattr(dictionary_lookup.urllib.request, "urlopen", _raise)
    result = dictionary_lookup.search("zzznotaword")
    assert result.found is False
    assert result.senses == ()


def test_search_network_failure_raises_service_unavailable(monkeypatch):
    def _raise(url, timeout=None):
        raise urllib.error.URLError("no route to host")

    monkeypatch.setattr(dictionary_lookup.urllib.request, "urlopen", _raise)
    with pytest.raises(DictionaryServiceUnavailable):
        dictionary_lookup.search("abandon")


FALLBACK_PAYLOAD = """
{
  "word": "abandon",
  "entries": [
    {
      "language": {"code": "en", "name": "English"},
      "partOfSpeech": "verb",
      "pronunciations": [{"type": "ipa", "text": "/\\u0259\\u02c8b\\u00e6n.d\\u0259n/", "tags": []}],
      "senses": [
        {"definition": "To leave; to give up.", "examples": ["They abandoned ship."], "synonyms": ["desert"], "antonyms": []},
        {"definition": "To yield oneself without restraint.", "examples": [], "synonyms": [], "antonyms": []}
      ]
    }
  ]
}
"""


def test_search_falls_back_to_freedictionaryapi_when_primary_is_unreachable(monkeypatch):
    def _urlopen(url, timeout=None):
        if "dictionaryapi.dev" in url.full_url:
            raise urllib.error.URLError("no route to host")
        return _FakeHTTPResponse(FALLBACK_PAYLOAD)

    monkeypatch.setattr(dictionary_lookup.urllib.request, "urlopen", _urlopen)
    result = dictionary_lookup.search("abandon")

    assert result.found is True
    assert result.ipa == "/əˈbæn.dən/"
    assert result.audio_url is None  # freedictionaryapi.com carries no audio field
    assert len(result.senses) == 2
    assert result.senses[0].definition == "To leave; to give up."
    assert result.senses[0].example == "They abandoned ship."
    assert result.synonyms == ("desert",)


def test_search_falls_back_to_freedictionaryapi_when_primary_says_not_found(monkeypatch):
    def _urlopen(url, timeout=None):
        if "dictionaryapi.dev" in url.full_url:
            raise urllib.error.HTTPError(url, 404, "Not Found", hdrs=None, fp=None)
        return _FakeHTTPResponse(FALLBACK_PAYLOAD)

    monkeypatch.setattr(dictionary_lookup.urllib.request, "urlopen", _urlopen)
    result = dictionary_lookup.search("abandon")

    assert result.found is True
    assert result.senses[0].definition == "To leave; to give up."


def test_search_raises_when_both_sources_are_unreachable(monkeypatch):
    def _raise(url, timeout=None):
        raise urllib.error.URLError("no route to host")

    monkeypatch.setattr(dictionary_lookup.urllib.request, "urlopen", _raise)
    with pytest.raises(DictionaryServiceUnavailable):
        dictionary_lookup.search("abandon")


def test_search_reports_not_found_when_neither_source_knows_the_word(monkeypatch):
    def _raise_404(url, timeout=None):
        raise urllib.error.HTTPError(url, 404, "Not Found", hdrs=None, fp=None)

    monkeypatch.setattr(dictionary_lookup.urllib.request, "urlopen", _raise_404)
    result = dictionary_lookup.search("zzznotaword")
    assert result.found is False
    assert result.senses == ()


def test_search_reports_not_found_when_fallback_answers_with_empty_entries(monkeypatch):
    """freedictionaryapi.com signals "unknown word" with a 200 and an empty
    entries list rather than a 404 — must not be mistaken for a real hit."""

    def _urlopen(url, timeout=None):
        if "dictionaryapi.dev" in url.full_url:
            raise urllib.error.HTTPError(url, 404, "Not Found", hdrs=None, fp=None)
        return _FakeHTTPResponse('{"word": "zzznotaword", "entries": []}')

    monkeypatch.setattr(dictionary_lookup.urllib.request, "urlopen", _urlopen)
    result = dictionary_lookup.search("zzznotaword")
    assert result.found is False
    assert result.senses == ()


# ---------------------------------------------------------------- routes


def _create_user(client, auth_headers):
    res = client.post(
        "/users",
        headers=auth_headers,
        json={
            "display_name": "Reader",
            "native_language": "en",
            "target_language": "en",
            "data_folder": "~/FluencyOS",
        },
    )
    assert res.status_code == 201
    return res.json()["id"]


def test_dictionary_search_route_requires_token(client):
    res = client.get("/vocabulary/dictionary-search", params={"w": "abandon"})
    assert res.status_code == 401


def test_dictionary_search_route_merges_local_cefr(client, auth_headers, monkeypatch):
    """A word the bundled lexicon has no definition for goes online, and the
    band still comes from our own tables — no online dictionary has one.

    ONLINE_WORD rather than KNOWN_WORD: a word the lexicon can define is now
    answered from it and never reaches the network at all, which is what the
    next test covers."""
    from app.services import dictionary_lookup as transport

    monkeypatch.setattr(
        transport,
        "search",
        lambda word, timeout=None: DictionaryResult(
            word=word,
            found=True,
            ipa="/əˈbɒlɪʃ/",
            audio_url="https://example.test/audio.mp3",
            senses=(DictionarySense(pos="verb", definition="To do away with.", example=None),),
            synonyms=("scrap",),
        ),
    )

    res = client.get("/vocabulary/dictionary-search", headers=auth_headers, params={"w": ONLINE_WORD})
    assert res.status_code == 200
    body = res.json()
    assert body["found"] is True
    assert body["ipa"] == "/əˈbɒlɪʃ/"
    assert body["senses"][0]["pos"] == "verb"
    # cefr is NOT from the online dictionary — it comes from our own tables
    assert body["cefr"] == "B2"


def test_a_word_the_lexicon_can_define_never_goes_online(client, auth_headers, monkeypatch):
    """The point of the whole ladder: the nearest source answers, and the
    network is not touched. Every search used to pay for a round trip."""
    from app.services import dictionary_lookup as transport

    def _explode(word, timeout=None):
        raise AssertionError(f"went online for {word!r}, which the lexicon knows")

    monkeypatch.setattr(transport, "search", _explode)

    body = client.get(
        "/vocabulary/dictionary-search", headers=auth_headers, params={"w": KNOWN_WORD}
    ).json()

    assert body["found"] is True
    assert "leave" in body["senses"][0]["definition"].lower()
    assert body["cefr"] == "B2"
    assert body["simpler"] == "leave"


def test_an_online_answer_is_kept_and_reused(client, auth_headers, monkeypatch):
    """Slow once, instant afterwards — the second search must not go out."""
    from app.services import dictionary_lookup as transport

    calls = []

    def _once(word, timeout=None):
        calls.append(word)
        return DictionaryResult(
            word=word,
            found=True,
            ipa="/əˈbɒlɪʃ/",
            audio_url=None,
            senses=(DictionarySense(pos="verb", definition="To do away with.", example=None),),
            synonyms=("scrap",),
        )

    monkeypatch.setattr(transport, "search", _once)
    first = client.get("/vocabulary/dictionary-search", headers=auth_headers, params={"w": ONLINE_WORD})

    def _explode(word, timeout=None):
        raise AssertionError("went online again for a word already looked up")

    monkeypatch.setattr(transport, "search", _explode)
    second = client.get("/vocabulary/dictionary-search", headers=auth_headers, params={"w": ONLINE_WORD})

    assert calls == [ONLINE_WORD]
    assert first.json()["senses"] == second.json()["senses"]
    assert second.json()["ipa"] == "/əˈbɒlɪʃ/"


def test_a_miss_is_not_kept(client, auth_headers, monkeypatch):
    """Caching "not a word" would freeze a dictionary's gap — including the
    gaps a flaky network invents — so a miss is paid for again."""
    from app.services import dictionary_lookup as transport

    calls = []

    def _miss(word, timeout=None):
        calls.append(word)
        return DictionaryResult(
            word=word, found=False, ipa=None, audio_url=None, senses=(), synonyms=()
        )

    monkeypatch.setattr(transport, "search", _miss)
    for _ in range(2):
        assert (
            client.get(
                "/vocabulary/dictionary-search", headers=auth_headers, params={"w": "zzqqxx"}
            ).json()["found"]
            is False
        )

    assert calls == ["zzqqxx", "zzqqxx"]


def test_dictionary_search_route_service_unavailable_returns_503(client, auth_headers, monkeypatch):
    from app.services import dictionary_lookup as transport

    def _raise(word, timeout=None):
        raise DictionaryServiceUnavailable("timed out")

    monkeypatch.setattr(transport, "search", _raise)
    res = client.get("/vocabulary/dictionary-search", headers=auth_headers, params={"w": ONLINE_WORD})
    assert res.status_code == 503


def test_save_manual_word_route_picks_up_local_cefr_when_known(client, auth_headers):
    user_id = _create_user(client, auth_headers)
    res = client.post(
        "/vocabulary/manual",
        headers=auth_headers,
        json={
            "user_id": user_id,
            "word": KNOWN_WORD,
            "pos": "verb",
            "definition": "To leave; to depart from.",
            "example": "They had to abandon the car in the snow.",
            "synonyms": ["desert", "forsake"],
            "ipa": "/əˈbændən/",
            "audio_url": "https://example.test/audio.mp3",
            "note": "first heard this in a podcast",
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["already_saved"] is False
    word = body["word"]
    assert word["pos"] == "verb"
    assert word["definition"] == "To leave; to depart from."
    assert word["ipa"] == "/əˈbændən/"
    assert word["audio_url"] == "https://example.test/audio.mp3"
    assert word["cefr"] == "B2"  # from the offline lexicon, not the payload
    assert word["synonyms"] == ["desert", "forsake"]

    detail = client.get(
        f"/vocabulary/by-word/{KNOWN_WORD}", headers=auth_headers, params={"user_id": user_id}
    ).json()
    assert detail["notes"][0]["text"] == "first heard this in a podcast"


def test_save_manual_word_route_word_unknown_to_local_lexicon_has_no_cefr(client, auth_headers):
    user_id = _create_user(client, auth_headers)
    res = client.post(
        "/vocabulary/manual",
        headers=auth_headers,
        json={
            "user_id": user_id,
            "word": UNKNOWN_LOCAL_WORD,
            "pos": "verb",
            "definition": "To express approval, especially for an accomplishment.",
        },
    )
    assert res.status_code == 200
    word = res.json()["word"]
    assert word["cefr"] is None
    assert word["simpler"] is None
    assert word["lemma"] == UNKNOWN_LOCAL_WORD


def test_save_manual_word_route_twice_does_not_duplicate(client, auth_headers):
    user_id = _create_user(client, auth_headers)
    payload = {
        "user_id": user_id,
        "word": KNOWN_WORD,
        "pos": "verb",
        "definition": "To leave; to depart from.",
    }
    first = client.post("/vocabulary/manual", headers=auth_headers, json=payload)
    second = client.post("/vocabulary/manual", headers=auth_headers, json=payload)
    assert first.json()["already_saved"] is False
    assert second.json()["already_saved"] is True
    assert first.json()["word"]["id"] == second.json()["word"]["id"]

    all_words = client.get("/vocabulary", headers=auth_headers, params={"user_id": user_id}).json()
    assert len(all_words) == 1


def test_manual_save_collides_with_a_reader_originated_save_of_the_same_lemma(client, auth_headers):
    """A word captured while reading (via cefr_lexicon) and later added
    manually for the same lemma must resolve to one row, not two."""
    user_id = _create_user(client, auth_headers)
    client.post("/vocabulary", headers=auth_headers, json={"user_id": user_id, "word": KNOWN_WORD})

    res = client.post(
        "/vocabulary/manual",
        headers=auth_headers,
        json={"user_id": user_id, "word": "abandoned", "pos": "verb", "definition": "A manual definition."},
    )
    assert res.json()["already_saved"] is True

    all_words = client.get("/vocabulary", headers=auth_headers, params={"user_id": user_id}).json()
    assert len(all_words) == 1
    # the original reader-originated definition (from cefr_lexicon) is kept, not overwritten
    assert all_words[0]["definition"] != "A manual definition."
