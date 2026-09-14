"""Recovering JSON from what a small model actually returns.

Every AI feature in the app asks for JSON, and a 1B model obliges most of the
time. The rest of the time it is *nearly* JSON. Refusing that is a 503 the
learner can do nothing about — the Vocabulary page showed exactly that:
"The local LLM's response wasn't valid JSON".

Each case here is a real failure shape, not a hypothetical.
"""

from app.services.voice.json_utils import parse_json_object, parse_json_value


def test_the_observed_failure_is_recovered():
    """Verbatim from gemma-3-1b, asked for three example sentences: the array
    is never closed and the object is closed twice."""
    raw = (
        '```json\n'
        '{"examples": ["I had a productive session of writing today.", '
        '"The team held a crucial session to discuss the project."}}\n'
        '```'
    )
    assert parse_json_object(raw) == {
        "examples": [
            "I had a productive session of writing today.",
            "The team held a crucial session to discuss the project.",
        ]
    }


def test_clean_json_is_untouched():
    assert parse_json_object('{"a": 1, "b": [2, 3]}') == {"a": 1, "b": [2, 3]}


def test_markdown_fences_are_stripped():
    assert parse_json_object('```json\n{"a": 1}\n```') == {"a": 1}
    assert parse_json_object('```\n{"a": 1}\n```') == {"a": 1}


def test_surrounding_prose_is_ignored():
    assert parse_json_object('Sure! Here it is:\n{"a": 1}\nHope that helps.') == {"a": 1}


def test_trailing_commas_are_forgiven():
    assert parse_json_object('{"a": [1, 2,],}') == {"a": [1, 2]}


def test_a_response_cut_off_by_max_tokens_keeps_what_arrived():
    """Truncation is not corruption — the sentences that did arrive are still
    good ones, and discarding them wastes the whole generation."""
    assert parse_json_object('{"examples": ["one.", "two."') == {"examples": ["one.", "two."]}


def test_an_unterminated_string_is_closed():
    assert parse_json_object('{"summary": "it was good') == {"summary": "it was good"}


def test_braces_inside_strings_are_not_structure():
    assert parse_json_object('{"note": "use {curly} braces"}') == {"note": "use {curly} braces"}
    assert parse_json_object('{"a": "]", "b": 1}') == {"a": "]", "b": 1}


def test_nested_structures_survive():
    raw = '{"errors": [{"bad": "x", "good": "y"}], "n": 1}'
    assert parse_json_object(raw) == {"errors": [{"bad": "x", "good": "y"}], "n": 1}


def test_a_bare_array_is_not_returned_as_an_object():
    """Callers expect keyed fields; handing back a list would push the failure
    into their .get() calls instead of surfacing it here."""
    assert parse_json_object("[1, 2, 3]") is None
    assert parse_json_value("[1, 2, 3]") == [1, 2, 3]


def test_unrecoverable_input_returns_none():
    for raw in ("", "   ", "I am not JSON at all.", "{{{{", "null"):
        assert parse_json_object(raw) is None, raw


def test_repair_never_raises():
    """This runs on untrusted model output; an exception here becomes a 500."""
    for raw in ('{"a": "\\\\', "{[}]", '"', "[", "{", '{"a": [[[[', "}" * 50):
        parse_json_object(raw)
