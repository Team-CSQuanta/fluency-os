"""Setup shared by the Selenium UI tests.

Before the tests run:
  1. The real FluencyOS backend starts, with its own empty database in a
     temporary folder — your own data is never touched.
  2. The real user interface starts, served by Vite (the dev server).
  3. Each test gets a fresh Chrome window pointed at the interface.

FluencyOS normally runs inside Electron, which gives the interface a small
bridge to the desktop (`window.fluencyos`): where the backend is, the
computer's hardware, file pickers, window buttons. A plain browser has no such
bridge, so BRIDGE below puts a simple stand-in in place before the page loads.

Chrome opens visibly so you can watch the tests click through the app.
Set HEADLESS=1 to run without a window (as on a server).
"""

import os
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import httpx
import pytest
from selenium import webdriver

ROOT = Path(__file__).resolve().parent.parent
TOKEN = "ui-test-token"

# The stand-in for Electron's desktop bridge. {api} is filled in below.
BRIDGE = """
window.fluencyos = {
  getBackendInfo: async () => ({ baseUrl: '{api}', token: '{token}' }),
  getSystemInfo: async () => ({
    cpuCores: 4, totalRamBytes: 8 * 1024 ** 3, platform: 'linux',
    dataFolder: '/tmp/fluencyos-ui-test', gpuVendor: null,
  }),
  pickDataFolder: async () => null,
  pickBookFiles: async () => [],
  pickMediaFiles: async () => [],
  pickSubtitleFile: async () => null,
  pickImageFile: async () => null,
  getPathForFile: () => '',
  minimizeWindow() {}, maximizeWindow() {}, closeWindow() {}, focusWindow() {},
  setDownloadActive() {}, setUiScale() {},
  onConfirmClose: () => () => {},
  forceClose() {},
};
"""


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _wait_until_up(url: str, headers: dict | None = None, seconds: float = 90) -> None:
    deadline = time.time() + seconds
    while time.time() < deadline:
        try:
            if httpx.get(url, headers=headers, timeout=2).status_code < 500:
                return
        except httpx.HTTPError:
            pass
        time.sleep(0.3)
    raise RuntimeError(f"{url} did not start within {seconds:.0f}s")


def _start(args: list[str], cwd: Path, env: dict) -> subprocess.Popen:
    # Its own process group, so stopping it also stops what it started
    # (npx starts Vite as a child process).
    kwargs = (
        {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP}
        if sys.platform == "win32"
        else {"start_new_session": True}
    )
    return subprocess.Popen(
        args, cwd=cwd, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, **kwargs
    )


def _stop(proc: subprocess.Popen) -> None:
    if proc.poll() is not None:
        return
    if sys.platform == "win32":
        subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"], capture_output=True)
    else:
        os.killpg(proc.pid, signal.SIGTERM)
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        proc.kill()


@pytest.fixture(scope="session")
def app_servers():
    """The backend and the interface, running for the whole test session."""
    data = Path(tempfile.mkdtemp(prefix="fluencyos-ui-test-"))
    api_port, ui_port = _free_port(), _free_port()
    api = f"http://127.0.0.1:{api_port}"
    ui = f"http://127.0.0.1:{ui_port}"
    npx = "npx.cmd" if sys.platform == "win32" else "npx"

    backend = _start(
        ["uv", "run", "python", "-m", "app.main", "--host", "127.0.0.1", "--port", str(api_port),
         "--token", TOKEN, "--db-path", str(data / "fluencyos.db")],
        cwd=ROOT / "backend",
        env={**os.environ, "FLUENCYOS_ALLOW_ORIGINS": ui},
    )
    interface = _start(
        [npx, "vite", "--host", "127.0.0.1", "--port", str(ui_port), "--strictPort"],
        cwd=ROOT / "renderer",
        env=dict(os.environ),
    )
    try:
        _wait_until_up(f"{api}/health", headers={"X-FluencyOS-Token": TOKEN})
        _wait_until_up(ui)
        yield {"api": api, "ui": ui}
    finally:
        _stop(interface)
        _stop(backend)
        shutil.rmtree(data, ignore_errors=True)


@pytest.fixture
def browser(app_servers):
    """A fresh Chrome window with the FluencyOS interface open."""
    options = webdriver.ChromeOptions()
    options.add_argument("--window-size=1280,860")
    if os.environ.get("HEADLESS") == "1":
        options.add_argument("--headless=new")
    driver = webdriver.Chrome(options=options)
    # Runs before any of the page's own scripts, on every page load.
    driver.execute_cdp_cmd(
        "Page.addScriptToEvaluateOnNewDocument",
        {"source": BRIDGE.replace("{api}", app_servers["api"]).replace("{token}", TOKEN)},
    )
    driver.get(app_servers["ui"])
    yield driver
    driver.quit()


@pytest.fixture
def api(app_servers):
    """Calls the same backend directly — to set things up quickly."""
    with httpx.Client(base_url=app_servers["api"], headers={"X-FluencyOS-Token": TOKEN}) as client:
        yield client


@pytest.fixture
def learner(api, browser):
    """A learner who has finished onboarding, signed in in the browser.

    Made through the API rather than by clicking through onboarding again —
    the onboarding tests already cover that — so these tests start on the
    main screens."""
    user = api.post(
        "/users",
        json={"display_name": "Ana", "native_language": "Bengali", "target_language": "English",
              "data_folder": "~/FluencyOS"},
    ).json()
    api.patch(f"/users/{user['id']}/placement", json={"cefr_level": "A1"})
    api.post(f"/users/{user['id']}/onboarding/complete")
    # The app remembers who is signed in here (see renderer/src/store/appStore.ts).
    browser.execute_script("localStorage.setItem('fluencyos.currentUserId', arguments[0]);", user["id"])
    browser.refresh()
    return user
