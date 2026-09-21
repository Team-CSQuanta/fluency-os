import sqlite3

from fastapi import APIRouter, Depends

from app.db import get_db
from app.models.activity import ActivityOut, DayActivityOut
from app.security import require_token
from app.services import activity

router = APIRouter(prefix="/activity", dependencies=[Depends(require_token)])


@router.get("", response_model=ActivityOut)
def get_activity(
    user_id: str, days: int = 365, conn: sqlite3.Connection = Depends(get_db)
) -> ActivityOut:
    """Pages read and cards answered on each of the last `days` days.

    The dashboard drew this from a seeded random number generator before it
    drew it from anything real, which made the one card on the screen whose
    whole job is honesty — did I show up? — the one card that lied.
    """
    rows = activity.daily(conn, user_id, days)
    return ActivityOut(
        days=[
            DayActivityOut(date=d.date, pages=d.pages, minutes=d.minutes, reviews=d.reviews)
            for d in rows
        ],
        total_pages=sum(d.pages for d in rows),
        total_reviews=sum(d.reviews for d in rows),
        active_days=sum(1 for d in rows if d.pages or d.reviews or d.minutes),
    )
