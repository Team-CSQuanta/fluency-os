"""Beginner tests, part 1: testing plain functions (unit tests).

A unit test checks one small piece of code on its own. Every test here has
the same three steps:

    Arrange  – set up the input
    Act      – call the function being tested
    Assert   – check the result is what we expect

If the result is different, `assert` fails and pytest shows the test in red.

Run just these tests with:   npm run test:beginner
"""

from app.services import level_test, pagination
from app.services.voice.reply_chunking import split_for_streaming


def test_550_words_count_as_2_pages():
    """The reading goal counts pages, and one page is 275 words."""
    # Arrange
    words_read = 550

    # Act
    pages = pagination.pages_from_words(words_read)

    # Assert
    assert pages == 2


def test_reading_nothing_counts_as_0_pages():
    """An edge case: nothing read must never count as progress."""
    assert pagination.pages_from_words(0) == 0
    assert pagination.pages_from_words(-10) == 0


def test_the_level_test_pass_mark_is_80_percent():
    """A level test has 15 questions; 80% of 15 is 12 correct answers."""
    # Arrange
    number_of_questions = 15

    # Act
    needed = level_test.pass_mark(number_of_questions)

    # Assert
    assert needed == 12


def test_a_learner_cannot_jump_up_a_level_without_the_test():
    """Business rule: going up needs the test, going down is free."""
    # A learner at B1 wants to go up to B2: not allowed without the test.
    assert level_test.free_to_set(current="B1", level="B2") is False
    # Going down to A2 is always allowed.
    assert level_test.free_to_set(current="B1", level="A2") is True


def test_a_reply_is_split_into_sentences_for_the_voice():
    """The AI's voice speaks a reply one sentence at a time, so the first
    sentence can start playing sooner."""
    # Arrange
    reply = "I went to the market. It was very busy!"

    # Act
    parts = split_for_streaming(reply)

    # Assert
    assert parts == ["I went to the market.", "It was very busy!"]
