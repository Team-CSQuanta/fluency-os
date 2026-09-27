"""Giving a test learner a CEFR level directly.

Through the API, a level above A1 is only reached by passing the level test
(level_test.free_to_set). Tests about reading, difficulty heat and the like
just need a learner at some level, so they set it where a passed test would —
in the database — instead of sitting a test first.
"""

from app.db import get_connection


def give_level(user_id: str, level: str) -> None:
    conn = get_connection()
    try:
        conn.execute("UPDATE users SET cefr_level = ? WHERE id = ?", (level, user_id))
        conn.commit()
    finally:
        conn.close()
