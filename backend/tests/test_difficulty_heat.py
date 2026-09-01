"""Difficulty heat tests (spec Phase 6).

The contract that matters: spans are character offsets into the block's raw
text, in the same coordinate space highlights use, so the reader can wrap
exactly those characters.
"""

from app.services import difficulty_heat


def test_spans_point_at_the_right_characters():
    text = "She was reticent about the findings."

    spans = difficulty_heat.spans_for_text(text, "B1")

    assert len(spans) == 1
    span = spans[0]
    assert text[span.start_char : span.end_char] == "reticent"
    assert span.cefr == "C1"
    assert span.simpler == "quiet"


def test_only_words_above_the_target_are_returned():
    text = "She was reticent about the findings."

    assert difficulty_heat.spans_for_text(text, "C1") == []
    assert difficulty_heat.spans_for_text(text, "C2") == []


def test_the_same_page_differs_by_reader_level():
    """A B1 reader and a C1 reader must see different tinting — this is the
    whole feature."""
    text = "The arduous, abstruse argument ossified into procedure."

    b1 = {s.word for s in difficulty_heat.spans_for_text(text, "B1")}
    c1 = {s.word for s in difficulty_heat.spans_for_text(text, "C1")}

    assert "abstruse" in b1 and "arduous" in b1
    # C2 words remain above a C1 reader; C1 words no longer do.
    assert "abstruse" in c1
    assert "arduous" not in c1
    assert len(c1) < len(b1)


def test_inflected_forms_are_detected():
    text = "The arguments had ossified into procedure."

    words = {s.word for s in difficulty_heat.spans_for_text(text, "B1")}

    assert "ossified" in words


def test_spans_are_in_document_order_and_do_not_overlap():
    text = "An arduous and abstruse and mendacious account."

    spans = difficulty_heat.spans_for_text(text, "B1")

    assert [s.start_char for s in spans] == sorted(s.start_char for s in spans)
    for earlier, later in zip(spans, spans[1:]):
        assert earlier.end_char <= later.start_char


def test_every_occurrence_is_returned():
    """The reader tints each occurrence, so repeats are not de-duplicated."""
    text = "reticent and reticent again"

    spans = difficulty_heat.spans_for_text(text, "B1")

    assert len(spans) == 2


def test_distinct_above_level_collapses_repeats_to_lemmas():
    text = "reticent and reticent again, plus arduous"

    distinct = difficulty_heat.distinct_above_level(text, "B1")

    assert distinct == ["reticent", "arduous"]


def test_count_matches_span_count():
    text = "An arduous and abstruse account."

    assert difficulty_heat.count_above_level(text, "B1") == len(
        difficulty_heat.spans_for_text(text, "B1")
    )


def test_empty_and_invalid_inputs_are_safe():
    assert difficulty_heat.spans_for_text("", "B1") == []
    assert difficulty_heat.spans_for_text("Some ordinary text.", "") == []
    assert difficulty_heat.spans_for_text("Some ordinary text.", "D9") == []


def test_ordinary_prose_stays_untinted():
    """The costly failure mode is tinting everything, so an easy sentence must
    come back completely clean."""
    text = "The man went to the shop and bought some food for his family."

    assert difficulty_heat.spans_for_text(text, "B1") == []
