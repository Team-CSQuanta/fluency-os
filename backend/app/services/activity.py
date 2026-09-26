"""How much studying happened on each of the last N days.

Pages read come from reading_sessions, cards answered from review_logs.
Both are counted against the reader's own calendar day: reading_sessions
stores a local_date already, and review timestamps are converted to match so
the two land on the same square.
"""

import sqlite3
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

from app.services import pagination

MAX_DAYS = 400


@dataclass(frozen=True)
class DayActivity:
    date: str
    pages: int
    minutes: int
    reviews: int


def _local_day(stamp: str) -> str | None:
    """The local calendar day of a stored UTC timestamp."""
    try:
        parsed = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone().strftime("%Y-%m-%d")


def daily(conn: sqlite3.Connection, user_id: str, days: int) -> list[DayActivity]:
    """One entry per day, oldest first, gaps included — a calendar is mostly
    a picture of the gaps."""
    span = max(1, min(days, MAX_DAYS))
    today = date.today()
    first = today - timedelta(days=span - 1)

    reading = {
        row["local_date"]: (int(row["w"] or 0), int(row["s"] or 0))
        for row in conn.execute(
            "SELECT local_date, SUM(words_read) AS w, SUM(seconds) AS s "
            "FROM reading_sessions WHERE user_id = ? AND local_date >= ? GROUP BY local_date",
            (user_id, first.isoformat()),
        ).fetchall()
    }

    reviews: dict[str, int] = {}
    for row in conn.execute(
        "SELECT created_at FROM review_logs WHERE user_id = ?", (user_id,)
    ).fetchall():
        day = _local_day(row["created_at"])
        if day is not None and day >= first.isoformat():
            reviews[day] = reviews.get(day, 0) + 1

    out: list[DayActivity] = []
    for offset in range(span):
        day = (first + timedelta(days=offset)).isoformat()
        words, seconds = reading.get(day, (0, 0))
        out.append(
            DayActivity(
                date=day,
                pages=pagination.pages_from_words(words),
                minutes=round(seconds / 60),
                reviews=reviews.get(day, 0),
            )
        )
    return out
