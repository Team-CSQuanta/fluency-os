"""Daily reading goal, week bars and streak (spec §7.1).

Everything here derives from reading_sessions, which accumulates one row per
(user, book, local day). Progress is recorded in words rather than pages
because a page is itself a derived number — 275 words — and re-deriving it at
read time keeps a single definition of "a page" in pagination.py.

Only books flagged count_toward_goal contribute, so a reference PDF the reader
imported to search doesn't inflate the ring.
"""

import sqlite3
from datetime import date, timedelta

from app.services import pagination
from app.utils.ids import uuid7
from app.utils.time import iso8601_utc_now, local_date_today

DEFAULT_DAILY_PAGE_GOAL = 20
WEEK_DAYS = 7
# Sunday-as-6 in Python; the shelf labels Monday first.
DAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"]


def get_daily_goal(conn: sqlite3.Connection, user_id: str) -> int:
    row = conn.execute(
        "SELECT daily_page_goal FROM user_settings WHERE user_id = ?", (user_id,)
    ).fetchone()
    if row is None or row["daily_page_goal"] is None:
        return DEFAULT_DAILY_PAGE_GOAL
    return int(row["daily_page_goal"])


def set_daily_goal(conn: sqlite3.Connection, user_id: str, pages: int) -> int:
    """Onboarding may not have written a settings row yet, so this upserts."""
    conn.execute(
        """
        INSERT INTO user_settings (user_id, daily_page_goal) VALUES (?, ?)
        ON CONFLICT(user_id) DO UPDATE SET daily_page_goal = excluded.daily_page_goal
        """,
        (user_id, pages),
    )
    return pages


def record_progress(
    conn: sqlite3.Connection,
    *,
    book_id: str,
    user_id: str,
    previous_max_block: int,
    new_max_block: int,
) -> int:
    """Credit the words in the blocks newly seen for the first time.

    Keyed off max_block_seen rather than the current position so re-reading an
    earlier chapter never double-counts toward the day's goal. Returns the
    number of words credited (0 when the reader only moved backwards).
    """
    if new_max_block <= previous_max_block:
        return 0

    count_toward_goal = conn.execute(
        "SELECT count_toward_goal FROM books WHERE id = ?", (book_id,)
    ).fetchone()
    if count_toward_goal is None or not count_toward_goal["count_toward_goal"]:
        return 0

    row = conn.execute(
        """
        SELECT COALESCE(SUM(word_count), 0) AS w FROM book_blocks
        WHERE book_id = ? AND block_index > ? AND block_index <= ?
        """,
        (book_id, previous_max_block, new_max_block),
    ).fetchone()
    words = int(row["w"])
    if words <= 0:
        return 0

    now = iso8601_utc_now()
    conn.execute(
        """
        INSERT INTO reading_sessions (id, book_id, user_id, local_date, started_at, ended_at, words_read, seconds)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0)
        ON CONFLICT(user_id, book_id, local_date) DO UPDATE SET
          words_read = words_read + excluded.words_read,
          ended_at = excluded.ended_at
        """,
        (uuid7(), book_id, user_id, local_date_today(), now, now, words),
    )
    return words


def open_session(conn: sqlite3.Connection, *, book_id: str, user_id: str) -> sqlite3.Row:
    """Today's row for this book, created if the reader hasn't opened it yet.

    One row per (user, book, day) rather than one per sitting: the goal ring
    and the streak only ever ask "how much on this day", and a row per sitting
    would need the same GROUP BY on every read for no extra information.
    """
    now = iso8601_utc_now()
    conn.execute(
        """
        INSERT INTO reading_sessions (id, book_id, user_id, local_date, started_at, ended_at, words_read, seconds)
        VALUES (?, ?, ?, ?, ?, ?, 0, 0)
        ON CONFLICT(user_id, book_id, local_date) DO NOTHING
        """,
        (uuid7(), book_id, user_id, local_date_today(), now, now),
    )
    row = conn.execute(
        "SELECT * FROM reading_sessions WHERE user_id = ? AND book_id = ? AND local_date = ?",
        (user_id, book_id, local_date_today()),
    ).fetchone()
    return row


def add_seconds(conn: sqlite3.Connection, *, session_id: str, seconds: int) -> sqlite3.Row | None:
    """Heartbeat. Time is accumulated rather than set, so a dropped beat costs
    one interval instead of rewriting the day's total from a stale number."""
    conn.execute(
        "UPDATE reading_sessions SET seconds = seconds + ?, ended_at = ? WHERE id = ?",
        (max(0, seconds), iso8601_utc_now(), session_id),
    )
    return conn.execute("SELECT * FROM reading_sessions WHERE id = ?", (session_id,)).fetchone()


def _words_by_day(conn: sqlite3.Connection, user_id: str) -> dict[str, int]:
    rows = conn.execute(
        "SELECT local_date, SUM(words_read) AS w FROM reading_sessions WHERE user_id = ? GROUP BY local_date",
        (user_id,),
    ).fetchall()
    return {row["local_date"]: int(row["w"] or 0) for row in rows}


def pages_on(conn: sqlite3.Connection, user_id: str, day: str) -> int:
    row = conn.execute(
        "SELECT COALESCE(SUM(words_read), 0) AS w FROM reading_sessions WHERE user_id = ? AND local_date = ?",
        (user_id, day),
    ).fetchone()
    return pagination.pages_from_words(int(row["w"]))


def week_pages(conn: sqlite3.Connection, user_id: str) -> list[tuple[str, str, int]]:
    """(iso date, single-letter label, pages) for the 7 days ending today."""
    by_day = _words_by_day(conn, user_id)
    today = date.today()
    out: list[tuple[str, str, int]] = []
    for offset in range(WEEK_DAYS - 1, -1, -1):
        day = today - timedelta(days=offset)
        key = day.isoformat()
        out.append((key, DAY_LABELS[day.weekday()], pagination.pages_from_words(by_day.get(key, 0))))
    return out


def streak_days(conn: sqlite3.Connection, user_id: str, goal: int) -> int:
    """Consecutive days the goal was met, counting back from today.

    A day only breaks the streak once it is over, so a goal not yet met *today*
    leaves yesterday's streak standing rather than showing 0 every morning.
    """
    if goal <= 0:
        return 0
    by_day = _words_by_day(conn, user_id)
    if not by_day:
        return 0

    today = date.today()
    start = today
    if pagination.pages_from_words(by_day.get(today.isoformat(), 0)) < goal:
        start = today - timedelta(days=1)

    streak = 0
    day = start
    while pagination.pages_from_words(by_day.get(day.isoformat(), 0)) >= goal:
        streak += 1
        day -= timedelta(days=1)
    return streak


def books_read_on(conn: sqlite3.Connection, user_id: str, day: str) -> int:
    row = conn.execute(
        "SELECT COUNT(DISTINCT book_id) AS c FROM reading_sessions "
        "WHERE user_id = ? AND local_date = ? AND words_read > 0",
        (user_id, day),
    ).fetchone()
    return int(row["c"])
