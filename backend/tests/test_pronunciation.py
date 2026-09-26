"""IPA from CMUdict, offline.

WordNet has definitions but no phonetics, and dictionaryapi.dev was the only
source of IPA — so a word it had never heard of, or any word saved while
offline, showed no pronunciation at all. These cover the conversion and the
lookup that close that gap.
"""

import pytest

from app.services import pronunciation
from app.services.arpabet import to_ipa


# --- the conversion ---------------------------------------------------------


@pytest.mark.parametrize(
    "arpabet,expected",
    [
        # Stress belongs at the start of the syllable, not before the vowel.
        # Marking the vowel would give "sɛˈʃən" here.
        ("S EH1 SH AH0 N", "ˈsɛʃən"),
        # Maximal onset: "st" starts the second syllable, so the mark goes
        # before it, not between s and t.
        ("AH0 S T AW1 N D", "əˈstaʊnd"),
        # Unstressed AH is a schwa, and "pj" stays together as an onset.
        ("K AH0 M P Y UW1 T ER0", "kəmˈpjutɚ"),
        # Both stress levels.
        ("D IH1 K SH AH0 N EH2 R IY0", "ˈdɪkʃəˌnɛɹi"),
        # A one-syllable word needs no mark; there is nothing to contrast.
        ("K AE1 T", "kæt"),
        ("TH IH1 NG K", "θɪŋk"),
        # ER carries the same stressed/unstressed split as AH.
        ("W AH1 N D ER0", "ˈwʌndɚ"),
    ],
)
def test_arpabet_converts_to_ipa(arpabet, expected):
    assert to_ipa(arpabet) == expected


def test_a_monosyllable_never_gets_a_stress_mark():
    for arpabet in ("K AE1 T", "S T ER1 N", "AE1 M"):
        assert "ˈ" not in to_ipa(arpabet), arpabet


def test_every_multisyllable_marks_its_primary_stress():
    for arpabet in ("S EH1 SH AH0 N", "AH0 B AW1 T", "K AH0 M P Y UW1 T ER0"):
        assert to_ipa(arpabet).count("ˈ") == 1, arpabet


def test_unreadable_input_returns_empty_not_partial():
    """Half a transcription is worse than none — it looks authoritative."""
    assert to_ipa("XX1 YY2") == ""
    assert to_ipa("") == ""
    assert to_ipa([]) == ""
    assert to_ipa("S EH1 QQ9") == ""


def test_conversion_never_raises():
    for junk in ("1 2 3", "   ", "AH", "AH9", "S S S S S", "0"):
        to_ipa(junk)


# --- the lookup -------------------------------------------------------------


def test_the_table_covers_the_bulk_of_english():
    assert pronunciation.size() > 120_000


def test_common_words_resolve():
    for word in ("session", "excerpt", "collate", "wonder", "reticent", "ubiquitous"):
        ipa = pronunciation.ipa_for(word)
        assert ipa and "ˈ" in ipa or ipa, word


def test_the_surface_form_wins_over_the_lemma():
    """"leaves" has its own entry; falling straight back to "leave" would
    show a pronunciation the learner did not ask about."""
    assert pronunciation.ipa_for("leaves") == "livz"
    assert pronunciation.ipa_for("leaves") != pronunciation.ipa_for("leave")


def test_inflections_fall_back_to_the_lemma_when_unlisted():
    assert pronunciation.ipa_for("running")
    assert pronunciation.ipa_for("cats")


def test_lookup_is_case_insensitive():
    assert pronunciation.ipa_for("Session") == pronunciation.ipa_for("session")


def test_unknown_words_return_none_rather_than_a_guess():
    """Inventing a pronunciation is worse than admitting there isn't one."""
    assert pronunciation.ipa_for("zzzznotaword") is None
    assert pronunciation.ipa_for("") is None
    assert pronunciation.ipa_for("   ") is None


def test_saved_words_get_ipa_even_without_one_stored(client, auth_headers):
    """The read-time fallback: a word saved before this table existed, or
    saved while the online dictionary was down, still shows how to say it."""
    res = client.post(
        "/users",
        headers=auth_headers,
        json={"display_name": "R", "native_language": "en", "target_language": "en", "data_folder": "~/F"},
    )
    user_id = res.json()["id"]
    client.post(
        "/vocabulary/manual",
        headers=auth_headers,
        json={"user_id": user_id, "word": "collate", "pos": "verb", "definition": "d", "synonyms": []},
    )
    row = client.get("/vocabulary", headers=auth_headers, params={"user_id": user_id}).json()[0]
    assert row["ipa"] == "/kəˈleɪt/"


def test_ipa_is_written_the_same_way_whatever_its_source():
    """dictionaryapi.dev wraps IPA in slashes and CMUdict-derived IPA does
    not, so a list mixing the two rendered some entries with delimiters and
    some without."""
    assert pronunciation.display("/ˈwʌndə/") == "/ˈwʌndə/"
    assert pronunciation.display("ˈwʌndɚ") == "/ˈwʌndɚ/"
    assert pronunciation.display("  /ˈwʌndə/  ") == "/ˈwʌndə/"
    assert pronunciation.display(None) is None
    assert pronunciation.display("") is None
    assert pronunciation.display("//") is None
