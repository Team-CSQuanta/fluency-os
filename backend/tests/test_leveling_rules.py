"""Rules-engine leveling tests (spec §7.3).

The engine's whole value is that it is deterministic and conservative: it must
leave alone everything it wasn't asked to change, and never invent a
replacement it has no data for.
"""

from app.services.leveling import EngineUnavailable, rules
from app.services.leveling.rules_engine import _load_phrases, _match_case


def _level(text, mode="inline", target="B1"):
    return rules.level(text, mode, target)


def test_below_level_text_comes_back_unchanged():
    text = "The man went to the shop for food."
    result = _level(text)

    assert result.text == text
    assert result.substitutions == []
    # One merged span rather than one per word.
    assert len(result.segments) == 1
    assert result.note is not None  # "nothing above your level"


def test_above_level_word_is_replaced_and_ledgered():
    result = _level("She was reticent about the findings.")

    assert "reticent" not in result.text
    assert result.substitutions
    originals = [original for original, _ in result.substitutions]
    assert "reticent" in originals


def test_untouched_prose_is_byte_identical():
    text = "She was reticent about the findings."
    result = _level(text)

    # Everything that isn't a substitution must survive character for character.
    rebuilt = "".join(s.original if s.original is not None else s.text for s in result.segments)
    assert rebuilt == text


def test_engine_is_deterministic():
    text = "She was reticent about the findings."
    assert _level(text).text == _level(text).text


def test_target_level_changes_the_result():
    text = "She was reticent about the findings."
    # A C2 reader is above the word, so nothing should be simplified for them.
    assert _level(text, target="C2").text == text
    assert _level(text, target="A2").text != text


def test_word_above_level_with_no_synonym_is_left_alone():
    """Inventing a replacement is worse than leaving a hard word in place."""
    from app.services import cefr_lexicon

    hard_without_simpler = [
        e.lemma
        for e in {v.lemma: v for v in _all_entries()}.values()
        if cefr_lexicon.rank(e.cefr) > cefr_lexicon.rank("B1") and not e.simpler
    ]
    if not hard_without_simpler:
        return  # every hard word in the shipped list has a synonym

    word = hard_without_simpler[0]
    result = _level(f"The {word} remained.")
    assert word in result.text


def _all_entries():
    from app.services import cefr_lexicon

    cefr_lexicon.size()  # force the load
    return list(cefr_lexicon._load().values())


def test_capitalisation_is_carried_across():
    assert _match_case("Reticent", "quiet") == "Quiet"
    assert _match_case("RETICENT", "quiet") == "QUIET"
    assert _match_case("reticent", "quiet") == "quiet"


def test_sentence_initial_substitution_keeps_its_capital():
    result = _level("Reticent people rarely explain themselves.")
    if result.substitutions:
        assert result.text[0].isupper()


def test_lexical_mode_replaces_a_phrase_as_one_unit():
    result = _level("They had to put up with the noise.", mode="lexical", target="B1")

    assert "put up with" not in result.text
    assert any(original.lower() == "put up with" for original, _ in result.substitutions)


def test_inline_mode_does_not_use_the_phrase_table():
    """Phrases are the one thing that separates lexical from inline; if inline
    also expanded them the two modes would be indistinguishable."""
    text = "They had to put up with the noise."
    assert "put up with" in _level(text, mode="inline", target="B1").text


def test_longer_phrase_wins_over_a_shorter_overlapping_one():
    phrases = {p.phrase for p in _load_phrases()}
    assert "go through with" in phrases

    result = _level("She would not go through with it.", mode="lexical", target="B1")
    originals = [original.lower() for original, _ in result.substitutions]
    assert "go through with" in originals


def test_phrase_below_target_level_is_not_replaced():
    # "take part in" is A2 — a B1 reader already knows it.
    result = _level("They take part in the race.", mode="lexical", target="B1")
    assert "take part in" in result.text


def test_generative_modes_are_rejected_by_the_rules_engine():
    for mode in ("contextual", "semantic"):
        assert not rules.supports(mode)
        try:
            rules.level("Anything at all.", mode, "B1")
        except EngineUnavailable:
            pass
        else:
            raise AssertionError(f"{mode} should not be servable by rules-v1")


def test_empty_text_is_handled():
    result = _level("")
    assert result.text == ""
    assert result.substitutions == []
