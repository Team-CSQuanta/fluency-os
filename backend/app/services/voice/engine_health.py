"""Whether a cloud engine has actually answered, as opposed to merely being
configured.

A saved API key proves nothing — it can be revoked, mistyped, or out of quota,
and every one of those looks identical until a real request is made. So a
cloud engine counts as ready only once a request has genuinely succeeded, and
a single transport-level failure takes that back.

Recorded at the HTTP boundary, so "verified" means the service answered us —
not that we liked the answer. A reply that parses badly is a model quirk, not
a broken key, and must not flip the engine to unusable.
"""

import threading
from pathlib import Path

from app.config import settings

_lock = threading.Lock()
# (provider, model) -> last transport outcome. Absent means never attempted,
# which is deliberately distinct from "attempted and failed".
_outcomes: dict[tuple[str, str], str | None] = {}


def record_success(provider: str, model: str) -> None:
    with _lock:
        _outcomes[(provider, model)] = None


def record_failure(provider: str, model: str, error: str) -> None:
    with _lock:
        _outcomes[(provider, model)] = error


def is_verified(provider: str, model: str) -> bool:
    with _lock:
        return (provider, model) in _outcomes and _outcomes[(provider, model)] is None


def last_error(provider: str, model: str) -> str | None:
    with _lock:
        return _outcomes.get((provider, model))


# Switched off from the AI button. Checked by every cloud request before it
# leaves, so "off" means nothing is sent — not merely that the badge is grey.
# Kept as a file beside the database, so it survives a restart: someone who
# switched the cloud AI off has not agreed to it coming back on by itself.
OFF_MESSAGE = "The cloud AI is switched off. Turn it on from the AI button in the top bar."


def _off_flag() -> Path:
    return Path(settings.db_path).resolve().parent / "cloud-ai-off"


def switch_cloud_off() -> None:
    with _lock:
        _off_flag().touch()
        # Whatever was proven before it went off is not claimed after.
        _outcomes.clear()


def switch_cloud_on() -> None:
    with _lock:
        _off_flag().unlink(missing_ok=True)


def cloud_is_off() -> bool:
    return _off_flag().exists()


def forget_all() -> None:
    """Called when credentials change: whatever was proven about the old key
    says nothing about the new one."""
    with _lock:
        _outcomes.clear()
