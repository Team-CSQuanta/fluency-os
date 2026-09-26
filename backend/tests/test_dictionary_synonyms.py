"""Synonym quality filtering.

The case that prompted this: looking up "Italian" in the video player showed
a "near synonyms" list that was almost entirely ethnic slurs, offered to a
language learner as vocabulary to acquire. The upstream payload marks none of
them — the sense carries the tag "countable" and nothing else — so this is
filtered on what the words are, not on what the source says about them.
"""

from app.services import dictionary_lookup


def _syns(*words: str) -> tuple[str, ...]:
    return dictionary_lookup._usable_synonyms(tuple(words))


def test_a_list_that_is_almost_all_unknown_words_is_dropped_entirely():
    """The real "Italian" payload. Keeping the banded remainder is not enough:
    `spaghetti` is banded as a food and appears here as a slur, so a
    word-by-word filter would pass it through on its own."""
    assert _syns(
        "dago", "Eyetie", "Itie", "goombah", "greaseball", "guido", "guinea", "spaghetti", "macaroni"
    ) == ()


def test_a_genuine_list_survives_with_its_common_words():
    kept = _syns("cheerful", "content", "delighted", "glad", "merry", "sonsy", "blithen", "chirk")
    assert "cheerful" in kept and "glad" in kept
    # Archaic dialect words are no use to a learner even when they are real.
    assert "sonsy" not in kept and "blithen" not in kept


def test_an_empty_list_stays_empty():
    assert _syns() == ()


def test_the_list_is_capped_so_the_panel_stays_readable():
    kept = _syns(
        "cheerful", "content", "delighted", "glad", "merry", "pleased", "joyful", "quiet",
        "accept", "remove", "begin", "difficult",
    )
    assert len(kept) <= dictionary_lookup._MAX_SYNONYMS


def test_filtering_is_applied_on_the_way_out_of_search(monkeypatch):
    """Every caller gets the filtered list — the player's lookup panel and the
    vocabulary add-word modal share this one path."""
    raw = dictionary_lookup.DictionaryResult(
        word="Italian",
        found=True,
        ipa=None,
        audio_url=None,
        senses=(dictionary_lookup.DictionarySense(pos="noun", definition="An inhabitant of Italy.", example=None),),
        synonyms=("dago", "Eyetie", "goombah", "greaseball", "guido"),
    )
    monkeypatch.setattr(dictionary_lookup, "_search_one", lambda clean, *, timeout: raw)

    result = dictionary_lookup.search("Italian")
    assert result.synonyms == ()
    # The definition itself is untouched — only the synonym list was the problem.
    assert result.senses[0].definition == "An inhabitant of Italy."
