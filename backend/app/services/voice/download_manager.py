"""Explicit, user-triggered model downloads with real byte-level progress —
the mechanism behind Settings' "download" buttons. Runs each download in a
background thread so the triggering HTTP request returns immediately and
other requests can poll progress (or use the engine meanwhile) without
blocking on a multi-minute transfer.

Deliberately not huggingface_hub's own downloader: this app already hit that
library's newer "xet" transfer backend silently stalling on large files (see
model_manager.py's HF_HUB_DISABLE_XET note) — a plain streamed HTTP GET with
our own progress accounting is simpler and has proven more reliable here.
"""

import threading
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

from app.services.voice import model_catalog, model_manager, stt_engine

_HF_RESOLVE_BASE = "https://huggingface.co"
_USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)
_CHUNK_SIZE = 1 << 20  # 1 MiB


@dataclass
class DownloadState:
    status: str = "idle"  # idle | downloading | ready | error
    downloaded_bytes: int = 0
    total_bytes: int = 0
    error: str | None = None
    lock: threading.Lock = field(default_factory=threading.Lock, repr=False)


_states: dict[str, DownloadState] = {}
_states_lock = threading.Lock()


def _state_for(key: str) -> DownloadState:
    with _states_lock:
        if key not in _states:
            _states[key] = DownloadState()
        return _states[key]


def status(key: str) -> dict:
    s = _state_for(key)
    with s.lock:
        return {
            "status": s.status,
            "downloaded_bytes": s.downloaded_bytes,
            "total_bytes": s.total_bytes,
            "error": s.error,
        }


def _content_length(url: str) -> int:
    request = urllib.request.Request(url, headers={"User-Agent": _USER_AGENT}, method="HEAD")
    with urllib.request.urlopen(request, timeout=30) as res:
        return int(res.headers.get("Content-Length") or 0)


def _stream_to_file(url: str, dest: Path, state: DownloadState) -> None:
    """Streams one URL to disk, only ever adding to state.downloaded_bytes —
    never resetting state.total_bytes, so a multi-file download (TTS: model
    + voices) can report one combined, monotonically-increasing progress
    instead of the total visibly shrinking when the second, smaller file
    starts."""
    tmp = dest.with_suffix(dest.suffix + ".part")
    request = urllib.request.Request(url, headers={"User-Agent": _USER_AGENT})
    with urllib.request.urlopen(request, timeout=30) as res:
        tmp.parent.mkdir(parents=True, exist_ok=True)
        with open(tmp, "wb") as f:
            while True:
                chunk = res.read(_CHUNK_SIZE)
                if not chunk:
                    break
                f.write(chunk)
                with state.lock:
                    state.downloaded_bytes += len(chunk)
    tmp.replace(dest)


def _run_llm_download(key: str, option: model_catalog.LlmOption) -> None:
    state = _state_for(key)
    with state.lock:
        state.status, state.error, state.downloaded_bytes, state.total_bytes = "downloading", None, 0, 0
    try:
        url = f"{_HF_RESOLVE_BASE}/{option.repo_id}/resolve/main/{option.filename}"
        with state.lock:
            state.total_bytes = _content_length(url)
        _stream_to_file(url, model_catalog.llm_dest_path(option), state)
        with state.lock:
            state.status = "ready"
    except (urllib.error.URLError, OSError) as err:
        with state.lock:
            state.status, state.error = "error", str(err)


def _run_tts_download(key: str) -> None:
    state = _state_for(key)
    with state.lock:
        state.status, state.error, state.downloaded_bytes, state.total_bytes = "downloading", None, 0, 0
    try:
        model_dest, voices_dest = model_manager.tts_voice_paths()
        with state.lock:
            state.total_bytes = _content_length(model_manager.TTS_MODEL_URL) + _content_length(
                model_manager.TTS_VOICES_URL
            )
        _stream_to_file(model_manager.TTS_MODEL_URL, model_dest, state)
        _stream_to_file(model_manager.TTS_VOICES_URL, voices_dest, state)
        with state.lock:
            state.status = "ready"
    except (urllib.error.URLError, OSError) as err:
        with state.lock:
            state.status, state.error = "error", str(err)


def _run_stt_download(key: str) -> None:
    # faster-whisper manages its own HF cache/download internally with no
    # byte-progress hook exposed publicly — this just brackets the (blocking,
    # in this background thread) call with status transitions so Settings
    # still gets a real start/ready/error signal, just not a percentage.
    state = _state_for(key)
    with state.lock:
        state.status, state.error, state.downloaded_bytes, state.total_bytes = "downloading", None, 0, 0
    try:
        from faster_whisper import WhisperModel

        WhisperModel(stt_engine.MODEL_SIZE, device="cpu", compute_type="int8", download_root=str(model_manager.whisper_cache_dir()))
        with state.lock:
            state.status = "ready"
    except Exception as err:  # noqa: BLE001 — any load/download failure is surfaced, not crashed
        with state.lock:
            state.status, state.error = "error", str(err)


def start_download(kind: str, key: str) -> None:
    """kind: 'llm' | 'stt' | 'tts'. key: catalog key for 'llm', ignored otherwise."""
    state = _state_for(download_key(kind, key))
    with state.lock:
        if state.status == "downloading":
            return
        # Claimed here, under the same lock as the check above, so a second
        # rapid call can't slip through and start a concurrent writer on the
        # same destination file.
        state.status = "downloading"
    if kind == "llm":
        option = model_catalog.llm_option(key)
        thread = threading.Thread(target=_run_llm_download, args=(download_key(kind, key), option), daemon=True)
    elif kind == "tts":
        thread = threading.Thread(target=_run_tts_download, args=(download_key(kind, key),), daemon=True)
    elif kind == "stt":
        thread = threading.Thread(target=_run_stt_download, args=(download_key(kind, key),), daemon=True)
    else:
        raise ValueError(f"unknown download kind: {kind}")
    thread.start()


def download_key(kind: str, key: str) -> str:
    return f"{kind}:{key}" if kind == "llm" else kind
