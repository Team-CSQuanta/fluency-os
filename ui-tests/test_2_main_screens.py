"""UI tests, part 2: the main screens, for a learner who has finished onboarding.

The `learner` fixture (in conftest.py) creates that learner through the API
and signs them in, so these tests start straight on the main app. The `api`
fixture sets up data the same way — faster than clicking it in.
"""

from helpers import click_menu, sees

HARBOUR = {
    "word": "harbour",
    "pos": "noun",
    "definition": "A sheltered place for ships.",
    "synonyms": ["port"],
}


def test_the_review_page_says_when_nothing_is_saved_yet(browser, learner):
    click_menu(browser, "Review")

    assert sees(browser, "Nothing saved yet")


def test_a_saved_word_shows_on_the_vocabulary_page(browser, api, learner):
    # Arrange: save a word for this learner
    api.post("/vocabulary/manual", json={"user_id": learner["id"], **HARBOUR})

    # Act: open the Vocabulary page
    click_menu(browser, "Vocabulary")

    # Assert: the word is listed
    assert sees(browser, "harbour")


def test_a_saved_word_is_ready_to_review(browser, api, learner):
    api.post("/vocabulary/manual", json={"user_id": learner["id"], **HARBOUR})

    click_menu(browser, "Review")

    assert sees(browser, "Ready when you are")
