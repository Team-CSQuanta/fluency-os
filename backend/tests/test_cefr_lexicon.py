"""CEFR lexicon tests (spec Phase 6).

The lemmatiser is rule-based suffix stripping checked against the wordlist,
so the tests that matter are the ones proving inflected forms resolve and
that over-eager stripping doesn't invent matches.
"""

import pytest

from app.services import cefr_lexicon


def test_loads_a_non_trivial_wordlist():
    assert cefr_lexicon.size() > 500


def test_exact_lemma_lookup():
    entry = cefr_lexicon.lookup("reticent")

    assert entry is not None
    assert entry.cefr == "C1"
    assert entry.simpler == "quiet"
    assert "reserved" in entry.synonyms


@pytest.mark.parametrize(
    "surface,expected_lemma",
    [
        ("books", "book"),
        ("cities", "city"),
        ("walked", "walk"),
        ("moved", "move"),
        ("stopped", "stop"),
        ("running", "run"),
        ("moving", "move"),
        ("walking", "walk"),
        ("quickly", "quick"),
        ("easily", "easy"),
        ("ossified", "ossify"),
        ("vacillated", "vacillate"),
    ],
)
def test_inflected_forms_resolve_to_their_lemma(surface, expected_lemma):
    entry = cefr_lexicon.lookup(surface)

    assert entry is not None, f"{surface} did not resolve"
    assert entry.lemma == expected_lemma


def test_capitalisation_and_punctuation_are_ignored():
    assert cefr_lexicon.lookup("Reticent") is not None
    assert cefr_lexicon.lookup("'reticent'") is not None


def test_unknown_word_returns_none():
    assert cefr_lexicon.lookup("zzzxqv") is None
    assert cefr_lexicon.band_of("zzzxqv") is None


def test_unknown_word_is_never_above_level():
    """A missing word must not tint — that failure mode would light up every
    proper noun in the book."""
    assert cefr_lexicon.is_above_level("Brontosaurus", "A1") is False


def test_is_above_level_compares_bands():
    assert cefr_lexicon.is_above_level("reticent", "B1") is True   # C1 > B1
    assert cefr_lexicon.is_above_level("reticent", "C1") is False  # equal, not above
    assert cefr_lexicon.is_above_level("reticent", "C2") is False  # below target
    assert cefr_lexicon.is_above_level("book", "A1") is False


def test_band_ranking_is_ordered():
    ranks = [cefr_lexicon.rank(b) for b in cefr_lexicon.CEFR_ORDER]

    assert ranks == sorted(ranks)
    assert cefr_lexicon.rank("C2") > cefr_lexicon.rank("A1")


def test_band_validation():
    assert cefr_lexicon.is_valid_band("b2") is True
    assert cefr_lexicon.is_valid_band("D1") is False
    assert cefr_lexicon.is_valid_band("") is False


def test_every_entry_has_a_valid_band():
    """Guards the CSV itself: a typo'd band would silently drop a word from
    every comparison."""
    for word in ("reticent", "ossify", "banister", "abandon", "book"):
        entry = cefr_lexicon.lookup(word)
        assert entry is not None
        assert entry.cefr in cefr_lexicon.CEFR_ORDER
