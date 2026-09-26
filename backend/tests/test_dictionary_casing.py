"""Capitalisation in dictionary lookups.

These dictionaries treat a capital letter as meaningful, and the result is
genuinely startling: "Sleep" returns exactly one sense — "A surname from
English." — while "sleep" returns sixteen. A learner types a capital all the
time (start of a sentence, a phone keyboard, pasting from prose) and never
means the surname.

Everything here is stubbed. The real services are flaky, and these are about
which spelling gets asked for, not about the network.
"""

import pytest

from app.services import dictionary_lookup as dl
from app.services.dictionary_lookup import DictionaryResult, DictionarySense, DictionaryServiceUnavailable


def _result(word, senses, found=True):
    return DictionaryResult(
        word=word,
        found=found,
        ipa=None,
        audio_url=None,
        senses=tuple(DictionarySense(pos=p, definition=d, example=None) for p, d in senses),
        synonyms=(),
    )


@pytest.fixture
def fake_source(monkeypatch):
    """Maps an exact spelling to a canned result, and records what was asked."""
    table: dict[str, DictionaryResult] = {}
    asked: list[str] = []

    def _search_one(clean, *, timeout):
        asked.append(clean)
        return table.get(clean, _result(clean, [], found=False))

    monkeypatch.setattr(dl, "_search_one", _search_one)
    return {"table": table, "asked": asked}


def test_a_capitalised_common_word_falls_back_to_lowercase(fake_source):
    """The exact bug: "Sleep" is a surname, "sleep" is the word."""
    fake_source["table"]["Sleep"] = _result("Sleep", [("name", "A surname from English.")])
    fake_source["table"]["sleep"] = _result("sleep", [("verb", "To rest.")])

    got = dl.search("Sleep")
    assert got.word == "sleep"
    assert got.senses[0].definition == "To rest."


def test_a_genuine_proper_noun_keeps_its_capital(fake_source):
    """Lowercasing unconditionally would be wrong the other way round —
    "london" is not in these dictionaries at all."""
    fake_source["table"]["London"] = _result("London", [("name", "The capital of the UK.")])
    # "london" deliberately absent.
    got = dl.search("London")
    assert got.word == "London"
    assert got.senses[0].definition == "The capital of the UK."


def test_a_lowercase_query_asks_only_once(fake_source):
    """No second request when there is nothing to disambiguate."""
    fake_source["table"]["sleep"] = _result("sleep", [("verb", "To rest.")])
    dl.search("sleep")
    assert fake_source["asked"] == ["sleep"]


def test_the_capitalised_spelling_stands_when_lowercase_is_also_a_name(fake_source):
    fake_source["table"]["Baker"] = _result("Baker", [("name", "A surname.")])
    fake_source["table"]["baker"] = _result("baker", [("name", "Another surname.")])
    got = dl.search("Baker")
    assert got.word == "Baker"


def test_ordinary_senses_come_before_proper_noun_ones(fake_source):
    """Someone building a vocabulary almost never means the surname."""
    fake_source["table"]["baker"] = _result(
        "baker",
        [("name", "A surname."), ("noun", "A person who bakes."), ("name", "A place.")],
    )
    got = dl.search("baker")
    assert [s.pos for s in got.senses] == ["noun", "name", "name"]
    assert got.senses[0].definition == "A person who bakes."


def test_sense_order_is_otherwise_preserved(fake_source):
    fake_source["table"]["run"] = _result(
        "run", [("verb", "first"), ("noun", "second"), ("verb", "third")]
    )
    got = dl.search("run")
    assert [s.definition for s in got.senses] == ["first", "second", "third"]


def test_a_failed_lowercase_attempt_does_not_lose_the_original(monkeypatch):
    """The network here is genuinely flaky; a dropped first request must not
    turn into a failed lookup."""
    calls: list[str] = []

    def _search_one(clean, *, timeout):
        calls.append(clean)
        if clean == "sleep":
            raise DictionaryServiceUnavailable("network blip")
        return _result("Sleep", [("name", "A surname from English.")])

    monkeypatch.setattr(dl, "_search_one", _search_one)
    got = dl.search("Sleep")
    assert calls == ["sleep", "Sleep"]
    assert got.word == "Sleep"


def test_a_not_found_lowercase_falls_through(fake_source):
    fake_source["table"]["Kant"] = _result("Kant", [("name", "A philosopher.")])
    got = dl.search("Kant")
    assert fake_source["asked"] == ["kant", "Kant"]
    assert got.word == "Kant"
