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


def forget_all() -> None:
    """Called when credentials change: whatever was proven about the old key
    says nothing about the new one."""
    with _lock:
        _outcomes.clear()
