"""The report's two halves: the prompt/reader contract, and the deterministic
metrics.

The contract test here is the one that matters most. The original bug was a
prompt asking for three JSON keys while the reader expected six, leaving four
report fields permanently zero on every real session — with a green suite,
because the fake returned reader-shaped data. Both halves of that failure are
covered below.
"""

import pytest

from app.services import conversation_report
from app.services.conversation_report import LlmReportAnalysis, compute_metrics, report_system_prompt


class _Turn(dict):
    """conversation_turns rows are sqlite3.Row (subscript access); a dict is
    close enough for the pure metric functions, which only ever index."""


def _turn(speaker, text, created_at="2026-01-01T00:00:00Z", stt_confidence=None, speech_seconds=None):
    return _Turn(
        speaker=speaker,
        text=text,
        created_at=created_at,
        stt_confidence=stt_confidence,
        speech_seconds=speech_seconds,
        turn_index=0,
    )


# ---------------------------------------------------------------- the contract


def test_every_judged_field_is_named_in_the_prompt():
    """If a field can be read, the model must have been asked for it. This is
    the assertion that would have caught the original bug."""
    prompt = report_system_prompt(["reticent"])
    for name in LlmReportAnalysis.model_fields:
        assert f'"{name}"' in prompt, f"{name} is parsed but never requested"


def test_prompt_names_the_target_words_and_handles_having_none():
    assert "reticent, stark" in report_system_prompt(["reticent", "stark"])
    assert "(none)" in report_system_prompt([])


def test_analysis_tolerates_a_partial_answer_but_not_an_invented_field():
    """Small models drop keys; a partial report still beats no report. What
    they cannot do is smuggle in a field nothing asked for."""
    partial = LlmReportAnalysis.model_validate({"summary": "Nice work."})
    assert partial.summary == "Nice work."
    assert partial.grammatical_precision == 0
    assert partial.errors == []

    extra = LlmReportAnalysis.model_validate({"summary": "x", "fluency_score": 99})
    assert not hasattr(extra, "fluency_score")


# ---------------------------------------------------------------- deterministic metrics


def test_filler_rate_counts_hesitation_markers_per_hundred_words():
    turns = [_turn("user", "um I think uh it was basically fine")]  # 3 fillers of 8 words
    metrics = compute_metrics(turns, "B1")
    assert metrics.total_words == 8
    assert metrics.filler_rate_per_100w == pytest.approx(37.5)


def test_only_the_learners_words_are_measured():
    """The AI's turns are not the learner's speech and must never inflate
    their word count, run length, or vocabulary range."""
    turns = [
        _turn("ai", "here is an extraordinarily long and sophisticated sentence from the model"),
        _turn("user", "yes"),
    ]
    metrics = compute_metrics(turns, "B1")
    assert metrics.total_words == 1
    assert metrics.longest_run_words == 1


def test_longest_run_is_the_longest_single_learner_turn():
    turns = [_turn("user", "one two"), _turn("ai", "x"), _turn("user", "one two three four")]
    assert compute_metrics(turns, "B1").longest_run_words == 4


def test_type_token_ratio_counts_distinct_lemmas():
    turns = [_turn("user", "the cat and the cat")]  # 5 words, 3 distinct
    assert compute_metrics(turns, "B1").type_token_ratio == pytest.approx(0.6)


def test_response_delay_measures_the_learner_not_the_model():
    """Timed from the AI finishing to the learner replying. The old metric
    averaged every gap, so it was dominated by generation latency."""
    turns = [
        _turn("ai", "how was your week?", created_at="2026-01-01T00:00:00Z"),
        _turn("user", "good thanks", created_at="2026-01-01T00:00:04Z"),
        # A long gap that is the model thinking, not the learner pausing.
        _turn("ai", "tell me more", created_at="2026-01-01T00:00:30Z"),
    ]
    assert compute_metrics(turns, "B1").avg_response_delay_seconds == pytest.approx(4.0)


def test_words_per_minute_uses_measured_speech_time():
    turns = [_turn("user", "one two three four five six", speech_seconds=12.0)]  # 6 words in 12s = 30wpm
    assert compute_metrics(turns, "B1").words_per_minute == 30


def test_words_per_minute_is_none_without_measured_speech():
    """A text session has no speech rate. Reporting wall-clock here would be a
    number about the model's latency wearing a fluency label."""
    turns = [_turn("user", "typed not spoken")]
    assert compute_metrics(turns, "B1").words_per_minute is None


def test_above_level_words_are_relative_to_the_learners_band():
    turns = [_turn("user", "the ubiquitous cat")]
    at_a1 = compute_metrics(turns, "A1").above_level_words
    at_c2 = compute_metrics(turns, "C2").above_level_words
    assert len(at_c2) <= len(at_a1)


def test_unplaced_learner_still_gets_a_usable_band():
    """cefr_level is NULL for anyone who hasn't done placement; without a
    fallback every above-level comparison would silently read zero."""
    assert conversation_report.resolve_cefr(None) == conversation_report.DEFAULT_CEFR
    assert conversation_report.resolve_cefr("not-a-band") == conversation_report.DEFAULT_CEFR
    assert conversation_report.resolve_cefr("b2") == "B2"


def test_a_session_with_no_learner_turns_degrades_to_nothing_measured():
    metrics = compute_metrics([_turn("ai", "hello?")], "B1")
    assert metrics.total_words == 0
    assert metrics.words_per_minute is None
    assert metrics.avg_response_delay_seconds is None
    assert metrics.longest_run_words == 0
    assert metrics.type_token_ratio == 0.0
    assert metrics.pronunciation_score is None


def test_pronunciation_averages_real_stt_confidence():
    turns = [_turn("user", "a", stt_confidence=0.8), _turn("user", "b", stt_confidence=0.6)]
    assert compute_metrics(turns, "B1").pronunciation_score == 70


# ---------------------------------------------------------------- streaming audio chunks


def test_first_chunk_is_never_merged_however_short():
    """Synthesis is slower than real time, and its cost scales with length, so
    the opening fragment is exactly what should be synthesized alone — folding
    it into the next sentence measurably delays the first sound."""
    from app.services.voice.tts_engine import split_for_streaming

    chunks = split_for_streaming("That sounds lovely. What did you enjoy most about it?")
    assert chunks[0] == "That sounds lovely."
    assert len(chunks) == 2


def test_a_reply_never_splits_into_more_than_two_pieces():
    """Each synthesis call costs ~0.9s of fixed overhead on top of ~2.65s per
    second of audio, so a third chunk buys nothing but its own overhead — it
    makes the reply as a whole slower without advancing the first sound."""
    from app.services.voice.tts_engine import split_for_streaming

    chunks = split_for_streaming(
        "That sounds lovely. I went there once. It was very quiet. What did you read?"
    )
    assert len(chunks) == 2
    assert chunks[0] == "That sounds lovely."
    assert chunks[1] == "I went there once. It was very quiet. What did you read?"


def test_a_very_short_opener_is_not_given_its_own_call():
    """"Yes!" would spend 0.9s of overhead to advance the first sound by almost
    nothing, and delay everything after it."""
    from app.services.voice.tts_engine import split_for_streaming

    assert split_for_streaming("Yes! I went to a cafe and read for hours.") == [
        "Yes! I went to a cafe and read for hours."
    ]


def test_split_handles_a_single_sentence_and_empty_text():
    from app.services.voice.tts_engine import split_for_streaming

    assert split_for_streaming("Just the one sentence here.") == ["Just the one sentence here."]
    assert split_for_streaming("") == []
    assert split_for_streaming("   ") == []


def test_target_words_are_matched_as_words_not_substrings():
    """A substring test credits a learner with "cat" for saying "category",
    and points the report's evidence link at a turn where the word never
    appeared."""
    from app.services.conversation_report import says_word

    assert says_word("I have a cat", "cat") is True
    assert says_word("Cats everywhere!", "cat") is True
    assert says_word("She goes there often", "go") is True
    assert says_word("He walked home", "walk") is True

    assert says_word("I have a category of books", "cat") is False
    assert says_word("Let us start now", "art") is False
    assert says_word("a classy dress", "class") is False
    assert says_word("", "cat") is False


def test_word_usage_keys_are_matched_forgivingly():
    """The prompt lists target words and asks for them back as JSON keys, and
    a small model does not reliably echo them verbatim. An exact lookup turns
    a casing difference into a silent "avoided" — indistinguishable from the
    learner never trying."""
    from app.services.conversation_report import match_word_usage

    assert match_word_usage({"wonder": "spontaneous"}, "Wonder") == "spontaneous"
    assert match_word_usage({"Jack": "prompted"}, "jack") == "prompted"
    assert match_word_usage({"wonders": "incorrect"}, "Wonder") == "incorrect"
    # A value the schema doesn't define is not a verdict.
    assert match_word_usage({"jack": "maybe?"}, "jack") is None
    assert match_word_usage({}, "jack") is None
    assert match_word_usage({"other": "spontaneous"}, "jack") is None
