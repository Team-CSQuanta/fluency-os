"""Small helpers that make the UI tests read like instructions:

    type_into(browser, "Enter your name", "Ana")
    click(browser, "Continue")
    assert sees(browser, "Where you are now")

Each one waits (up to 10 seconds) for the page to catch up, because the
interface loads data from the backend and does not appear instantly.
"""

from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as ec
from selenium.webdriver.support.ui import WebDriverWait

WAIT_SECONDS = 10


def _xpath_text(text: str) -> str:
    """XPath string literal that copes with apostrophes (I'm a beginner)."""
    if "'" not in text:
        return f"'{text}'"
    parts = text.split("'")
    return "concat(" + ", \"'\", ".join(f"'{p}'" for p in parts) + ")"


def sees(browser, text: str) -> bool:
    """True once `text` appears anywhere on the page."""
    try:
        WebDriverWait(browser, WAIT_SECONDS).until(
            ec.presence_of_element_located((By.XPATH, f"//body//*[contains(normalize-space(.), {_xpath_text(text)})]"))
        )
        return True
    except Exception:
        return False


def click(browser, label: str) -> None:
    """Clicks the button whose text contains `label`."""
    xpath = f"//button[contains(normalize-space(.), {_xpath_text(label)})]"
    WebDriverWait(browser, WAIT_SECONDS).until(ec.element_to_be_clickable((By.XPATH, xpath))).click()


def click_menu(browser, item: str) -> None:
    """Clicks an item in the app's left-hand menu, e.g. "Review"."""
    xpath = f"//*[normalize-space(text())={_xpath_text(item)}]/ancestor-or-self::button[1]"
    WebDriverWait(browser, WAIT_SECONDS).until(ec.element_to_be_clickable((By.XPATH, xpath))).click()


def type_into(browser, placeholder: str, text: str) -> None:
    """Types into the text box showing `placeholder`."""
    box = WebDriverWait(browser, WAIT_SECONDS).until(
        ec.element_to_be_clickable((By.XPATH, f"//input[@placeholder={_xpath_text(placeholder)}]"))
    )
    box.clear()
    box.send_keys(text)
