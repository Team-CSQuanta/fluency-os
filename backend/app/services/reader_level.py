"""The CEFR band a page is judged against: an explicit request wins, then
the reader's placement level, then B1. Shared by both routers that tint."""

import sqlite3

from app.services import cefr_lexicon

DEFAULT_CEFR = "B1"


class UnknownBand(ValueError):
    """A requested target that is not a CEFR band."""


def resolve_target(conn: sqlite3.Connection, user_id: str | None, requested: str | None) -> str:
    """The band to judge against. Raises UnknownBand for a bad request."""
    if requested:
        if not cefr_lexicon.is_valid_band(requested):
            raise UnknownBand(f"target_cefr must be one of {', '.join(cefr_lexicon.CEFR_ORDER)}")
        return requested.upper()

    if user_id:
        row = conn.execute("SELECT cefr_level FROM users WHERE id = ?", (user_id,)).fetchone()
        if row is not None and row["cefr_level"] and cefr_lexicon.is_valid_band(row["cefr_level"]):
            return str(row["cefr_level"]).upper()

    return DEFAULT_CEFR
