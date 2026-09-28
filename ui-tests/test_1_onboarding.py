"""UI tests, part 1: a new learner goes through onboarding.

Selenium opens a real Chrome window and uses FluencyOS the way a person does:
it types, clicks buttons, and checks what appears on the screen. Each test
gets a fresh window, so each starts at the very first step — like someone
opening FluencyOS for the first time.

Run with:   npm run test:ui
"""

from helpers import click, sees, type_into


def start_onboarding(browser, name="Ana"):
    """Step 1: type a name and continue — several tests begin like this."""
    type_into(browser, "Enter your name", name)
    click(browser, "Continue")


def test_the_app_opens_on_the_first_onboarding_step(browser):
    assert sees(browser, "Who is learning")


def test_a_name_is_needed_to_continue(browser):
    # Act: press Continue without typing a name
    click(browser, "Continue")

    # Assert: the app explains what is missing
    assert sees(browser, "Please enter your name to continue.")


def test_entering_a_name_moves_on_to_the_level_step(browser):
    start_onboarding(browser)

    assert sees(browser, "Where you are now")


def test_a_beginner_can_start_at_a1_without_a_test(browser):
    start_onboarding(browser)

    click(browser, "I'm a beginner")

    # The learner's level is now A1, "Beginner", and they can move on.
    assert sees(browser, "Beginner")
    click(browser, "Continue")
    assert sees(browser, "How the AI runs")


def test_the_ai_step_recommends_a_model_for_this_computer(browser):
    start_onboarding(browser)
    click(browser, "I'm a beginner")
    click(browser, "Continue")

    assert sees(browser, "Recommended for this computer")


def test_finishing_onboarding_opens_the_main_app(browser):
    start_onboarding(browser)
    click(browser, "I'm a beginner")
    click(browser, "Continue")
    # A cloud model, so the test does not start a multi-gigabyte model download.
    click(browser, "Use a cloud model instead")
    click(browser, "Continue")
    assert sees(browser, "Your daily rhythm")

    click(browser, "Finish")

    # The main app's menu is now showing.
    assert sees(browser, "Learn by reading")
