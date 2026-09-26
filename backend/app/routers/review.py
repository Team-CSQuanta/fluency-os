import sqlite3

from fastapi import APIRouter, Depends, HTTPException, status

from app.db import get_db
from app.models.review import (
    RateCardIn,
    RateCardOut,
    ReviewCardOut,
    ReviewStatsOut,
    SuspendIn,
)
from app.security import require_token
from app.services import review

router = APIRouter(prefix="/review", dependencies=[Depends(require_token)])


@router.get("/queue", response_model=list[ReviewCardOut])
def get_queue(
    user_id: str,
    limit: int = review.DEFAULT_SESSION_LIMIT,
    new_limit: int = review.DEFAULT_NEW_PER_SESSION,
    conn: sqlite3.Connection = Depends(get_db),
) -> list[ReviewCardOut]:
    """Cards to answer now: everything due, then a capped number of new ones.

    Both caps are real scheduling policy, not pagination — spec §5.5's load
    smoothing. Handing over a 400-card backlog produces avoidance, not study."""
    return [ReviewCardOut(**c) for c in review.build_queue(conn, user_id, limit=limit, new_limit=new_limit)]


@router.get("/stats", response_model=ReviewStatsOut)
def get_stats(user_id: str, conn: sqlite3.Connection = Depends(get_db)) -> ReviewStatsOut:
    return ReviewStatsOut(**review.stats(conn, user_id))


@router.post("/cards/{vocab_word_id}/rate", response_model=RateCardOut)
def rate_card(
    vocab_word_id: str, payload: RateCardIn, conn: sqlite3.Connection = Depends(get_db)
) -> RateCardOut:
    """Answer one card. Writes a review_logs row with source='flashcard' —
    the same table conversation usage writes to, which is what makes the two
    sources schedule the same card (spec §5.5)."""
    try:
        result = review.answer_card(conn, payload.user_id, vocab_word_id, payload.rating)
    except LookupError as err:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No such word") from err
    except ValueError as err:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(err)) from err
    return RateCardOut(**result)


@router.post("/cards/{vocab_word_id}/suspend", status_code=status.HTTP_204_NO_CONTENT)
def suspend_card(
    vocab_word_id: str, payload: SuspendIn, conn: sqlite3.Connection = Depends(get_db)
) -> None:
    """Takes a card out of the queue (or puts it back) without losing its
    schedule — a leech reworked later should resume, not restart."""
    if not review.set_suspended(conn, payload.user_id, vocab_word_id, payload.suspended):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No such card")
