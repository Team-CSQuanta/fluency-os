"""The local chat model on the GPU, through llama.cpp's own prebuilt server.

Why a separate server rather than the in-process llama-cpp-python: the
Python package is compiled on install, and a GPU build needs a GPU SDK and
shader compiler on every machine — so in practice every install was CPU-only.
llama.cpp publishes ready-built servers for each platform instead:

  Windows  — Vulkan (NVIDIA, AMD and Intel GPUs, integrated ones included)
  Linux    — Vulkan (the same, through Mesa or the vendor driver)
  macOS    — Metal on Apple Silicon

so the app downloads the one for this machine (12-33 MB, once) and runs the
model through it. Measured on a Ryzen 3 3200G's integrated Vega 8 with
Gemma 3 1B: prompt reading 551 vs 265 tokens/s on 3 CPU threads, replies
23.5 vs 18.2 tokens/s — and the CPU is left free for speech in the meantime.

The in-process package stays as the CPU path, and as the fallback whenever
this one cannot start (no GPU build for the platform, offline, a driver
that fails): the caller decides, this module only reports why.
"""

import atexit
import concurrent.futures
import json
import os
import platform
import re
import secrets
import shutil
import socket
import subprocess
import tarfile
import threading
import time
import urllib.error
import urllib.request
import zipfile
from dataclasses import dataclass
from pathlib import Path

from app.services.voice import model_manager
from app.services.voice.errors import EngineUnavailable

# Pinned: a release whose server flags and API this code was tested against.
TAG = "b11205"
_RELEASES = f"https://github.com/ggml-org/llama.cpp/releases/download/{TAG}"

# Loading a model onto a slow GPU is real, sometimes minutes-long work.
_START_TIMEOUT_S = 600.0
_REQUEST_TIMEOUT_S = 600.0


def _arch(machine: str) -> str | None:
    m = machine.lower()
    if m in ("x86_64", "amd64"):
        return "x64"
    if m in ("arm64", "aarch64"):
        return "arm64"
    return None


def gpu_asset(system: str | None = None, machine: str | None = None) -> str | None:
    """The release file with a GPU build for this platform, or None when
    llama.cpp publishes none (e.g. Intel Macs, Windows on ARM)."""
    system = system or platform.system()
    arch = _arch(machine or platform.machine())
    if system == "Windows" and arch == "x64":
        return f"llama-{TAG}-bin-win-vulkan-x64.zip"
    if system == "Linux" and arch in ("x64", "arm64"):
        return f"llama-{TAG}-bin-ubuntu-vulkan-{arch}.tar.gz"
    if system == "Darwin" and arch == "arm64":
        return f"llama-{TAG}-bin-macos-arm64.tar.gz"
    return None


def gpu_backend_name(system: str | None = None) -> str:
    return "Metal" if (system or platform.system()) == "Darwin" else "Vulkan"


def install_dir() -> Path:
    return model_manager.models_dir() / "runtimes" / f"llama.cpp-{TAG}-gpu"


def _exe_name() -> str:
    return "llama-server.exe" if platform.system() == "Windows" else "llama-server"


def server_exe() -> Path | None:
    """The installed server, or None when it has not been downloaded."""
    root = install_dir()
    if not (root / ".complete").exists():
        return None
    found = next((p for p in root.rglob(_exe_name()) if p.is_file()), None)
    return found


def is_installed() -> bool:
    return server_exe() is not None


def install(archive: Path) -> Path:
    """Unpacks a downloaded release into place and returns the server path.
    Unpacked beside the target and moved in whole, so an interrupted unpack
    never leaves a half-runtime that looks installed."""
    root = install_dir()
    staging = root.with_name(root.name + ".unpacking")
    shutil.rmtree(staging, ignore_errors=True)
    staging.mkdir(parents=True)
    try:
        if archive.name.endswith(".zip"):
            with zipfile.ZipFile(archive) as z:
                for member in z.namelist():
                    target = (staging / member).resolve()
                    if not str(target).startswith(str(staging.resolve())):
                        raise OSError(f"unsafe path in archive: {member}")
                z.extractall(staging)
        else:
            with tarfile.open(archive) as t:
                try:
                    t.extractall(staging, filter="data")
                except TypeError:  # Python without extraction filters
                    for member in t.getmembers():
                        target = (staging / member.name).resolve()
                        if not str(target).startswith(str(staging.resolve())):
                            raise OSError(f"unsafe path in archive: {member.name}") from None
                    t.extractall(staging)
        exe = next((p for p in staging.rglob(_exe_name()) if p.is_file()), None)
        if exe is None:
            raise OSError("the download did not contain llama-server")
        if platform.system() != "Windows":
            exe.chmod(exe.stat().st_mode | 0o111)
        (staging / ".complete").write_text(TAG)
        shutil.rmtree(root, ignore_errors=True)
        staging.replace(root)
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        raise
    finally:
        archive.unlink(missing_ok=True)
    global _devices_cache
    _devices_cache = None  # a new build may see different devices
    exe = server_exe()
    assert exe is not None
    return exe


def _env(exe: Path) -> dict[str, str]:
    """The server's own libraries sit beside it; point the loader there."""
    env = dict(os.environ)
    lib = str(exe.parent)
    for var in ("LD_LIBRARY_PATH", "DYLD_LIBRARY_PATH"):
        env[var] = lib + (os.pathsep + env[var] if env.get(var) else "")
    return env


def _die_with_parent() -> None:
    """Linux only, run in the child before exec: if the backend is killed
    outright, the kernel ends the server too instead of leaving a model in
    memory with nothing to talk to it.

    The kernel ties this to the THREAD that started the child, not the
    process — which is why every server is started from `_spawner` below.
    Started from a request's worker thread, the server was killed seconds
    after that thread retired: the first reply worked, and the AI then read
    as not loaded."""
    try:
        import ctypes
        import signal

        ctypes.CDLL("libc.so.6", use_errno=True).prctl(1, signal.SIGTERM)  # PR_SET_PDEATHSIG
    except Exception:  # noqa: BLE001 — best effort; atexit still covers normal exits
        pass


# One thread that lives as long as the backend, and starts every server — see
# _die_with_parent for why the starting thread matters.
_spawner = concurrent.futures.ThreadPoolExecutor(max_workers=1, thread_name_prefix="llama-spawner")


def _creationflags() -> int:
    # No console window flashing up on Windows every time the model starts.
    return getattr(subprocess, "CREATE_NO_WINDOW", 0)


_DEVICE_LINE = re.compile(r"^\s*([A-Za-z]+\d+):\s*(.+?)\s*(?:\((\d+) MiB,.*\))?\s*$")


def parse_devices(output: str) -> list[str]:
    """GPU names from `llama-server --list-devices`, e.g.
    "Vulkan0: AMD Radeon Vega 8 Graphics (RADV RAVEN) (4971 MiB, 4280 MiB free)"."""
    devices = []
    listing = False
    for line in output.splitlines():
        if line.strip().startswith("Available devices"):
            listing = True
            continue
        if listing:
            match = _DEVICE_LINE.match(line)
            if not match:
                break
            devices.append(match.group(2))
    return devices


_devices_cache: list[str] | None = None


def gpu_devices() -> list[str]:
    """The GPUs the installed build can use; empty when none (or not installed)."""
    global _devices_cache
    if _devices_cache is not None:
        return _devices_cache
    exe = server_exe()
    if exe is None:
        return []
    try:
        out = subprocess.run(
            [str(exe), "--list-devices"],
            capture_output=True,
            text=True,
            timeout=60,
            env=_env(exe),
            creationflags=_creationflags(),
        )
        _devices_cache = parse_devices(out.stdout + "\n" + out.stderr)
    except (OSError, subprocess.SubprocessError):
        _devices_cache = []
    return _devices_cache


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@dataclass
class Server:
    process: subprocess.Popen
    port: int
    api_key: str
    model_path: str
    device: str
    log_path: Path
    log_file: object = None

    def url(self, path: str) -> str:
        return f"http://127.0.0.1:{self.port}{path}"

    def alive(self) -> bool:
        return self.process.poll() is None

    def stop(self) -> None:
        if self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.process.kill()
        if self.log_file is not None:
            self.log_file.close()
            self.log_file = None


_running: list[Server] = []
_running_lock = threading.Lock()


@atexit.register
def stop_all() -> None:
    # The server is a child process: it must not outlive the backend.
    with _running_lock:
        for server in _running:
            server.stop()
        _running.clear()


def _log_tail(path: Path, lines: int = 12) -> str:
    try:
        return "\n".join(path.read_text(errors="replace").splitlines()[-lines:])
    except OSError:
        return ""


def start(model_path: str, *, context: int = 4096) -> Server:
    """Starts the server with every layer on the GPU and waits until the model
    is loaded. Raises EngineUnavailable with the server's own last words if it
    cannot — the caller falls back to the CPU."""
    exe = server_exe()
    if exe is None:
        raise EngineUnavailable("The GPU runtime isn't downloaded yet.")
    devices = gpu_devices()
    if not devices:
        raise EngineUnavailable(f"No GPU that {gpu_backend_name()} can use was found on this computer.")

    port = _free_port()
    # The server listens on localhost only, but a browser page could still
    # reach it; a key only this backend knows keeps it ours.
    api_key = secrets.token_urlsafe(24)
    log_path = model_manager.models_dir() / "runtimes" / "llama-server.log"
    threads = max(1, (os.cpu_count() or 2) - 1)
    args = [
        str(exe),
        "-m", model_path,
        "--host", "127.0.0.1",
        "--port", str(port),
        "--api-key", api_key,
        "-c", str(context),
        "-ngl", "999",
        "-np", "1",
        # No thinking. Models that can think before answering (Gemma 4,
        # Qwen 3…) would otherwise spend the reply's whole token budget on
        # it: the server files thoughts apart from the answer, and a
        # conversation turn came back as an empty reply. A partner that
        # answers at once is what this app wants anyway.
        "--reasoning", "off",
        "-t", str(threads),
    ]
    log = open(log_path, "w", encoding="utf-8", errors="replace")  # noqa: SIM115 — owned by the process
    try:
        process = _spawner.submit(
            subprocess.Popen,
            args,
            stdout=log,
            stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL,
            env=_env(exe),
            creationflags=_creationflags(),
            preexec_fn=_die_with_parent if platform.system() == "Linux" else None,
        ).result()
    except OSError as err:
        log.close()
        raise EngineUnavailable(f"Couldn't start the GPU runtime: {err}") from err
    server = Server(process, port, api_key, model_path, devices[0], log_path, log)

    deadline = time.monotonic() + _START_TIMEOUT_S
    while time.monotonic() < deadline:
        if not server.alive():
            server.stop()
            raise EngineUnavailable(
                "The GPU runtime stopped while loading the model:\n" + _log_tail(log_path)
            )
        try:
            with urllib.request.urlopen(server.url("/health"), timeout=5) as res:
                if res.status == 200:
                    break
        except (urllib.error.URLError, OSError):
            pass  # 503 while loading, or not listening yet
        time.sleep(0.5)
    else:
        server.stop()
        raise EngineUnavailable("The GPU runtime took too long to load the model.")

    with _running_lock:
        _running.append(server)
    return server


def stop(server: Server) -> None:
    server.stop()
    with _running_lock:
        if server in _running:
            _running.remove(server)


def chat(
    server: Server,
    messages: list[dict],
    *,
    max_tokens: int,
    temperature: float,
    json_mode: bool = False,
) -> str:
    """One chat completion through the server's OpenAI-compatible API."""
    body: dict = {"messages": messages, "max_tokens": max_tokens, "temperature": temperature}
    if json_mode:
        # Enforced by the server with a grammar, so the answer is JSON by
        # construction rather than by the model's good behaviour.
        body["response_format"] = {"type": "json_object"}
    request = urllib.request.Request(
        server.url("/v1/chat/completions"),
        data=json.dumps(body).encode("utf-8"),
        method="POST",
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {server.api_key}"},
    )
    try:
        with urllib.request.urlopen(request, timeout=_REQUEST_TIMEOUT_S) as res:
            data = json.loads(res.read().decode("utf-8"))
        message = data["choices"][0]["message"]
    except (urllib.error.URLError, OSError, KeyError, IndexError, ValueError) as err:
        raise EngineUnavailable(f"Local LLM generation on the GPU failed: {err}") from err
    text = str(message.get("content") or "").strip()
    if not text:
        # Never hand back nothing as if it were an answer.
        if message.get("reasoning_content"):
            raise EngineUnavailable(
                "The local model spent its whole reply thinking and wrote no answer — try again."
            )
        raise EngineUnavailable("The local model returned an empty reply — try again.")
    return text
