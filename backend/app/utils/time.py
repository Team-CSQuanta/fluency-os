from datetime import datetime, timezone


def iso8601_utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def local_date_today() -> str:
    """The reader's own calendar day (YYYY-MM-DD). A daily goal and a streak
    are human-facing, so they roll over at the reader's local midnight rather
    than UTC's — the backend only ever runs on the reader's own machine."""
    return datetime.now().strftime("%Y-%m-%d")
