"""HTTP surface for the Forest (spec §8).

Read-only apart from the one thing the learner decides: sitting a focus
session. Everything else on this screen is a projection of their vocabulary
and is not writable by design.
"""

import sqlite3

from fastapi import APIRouter, Depends, HTTPException, status

from app.db import get_db
from app.models.forest import FocusOut, FocusStartIn, ForestOut, TreeOut
from app.services import forest

router = APIRouter(prefix="/forest", tags=["forest"])


@router.get("", response_model=ForestOut)
def get_forest(user_id: str, conn: sqlite3.Connection = Depends(get_db)) -> ForestOut:
    data = forest.summary(conn, user_id)
    return ForestOut(
        trees=[TreeOut(**vars(t)) for t in data["trees"]],
        stages=data["stages"],
        stage_names=list(forest.STAGES),
        dormant=data["dormant"],
    )


@router.post("/focus", response_model=FocusOut, status_code=status.HTTP_201_CREATED)
def start_focus(payload: FocusStartIn, conn: sqlite3.Connection = Depends(get_db)) -> FocusOut:
    try:
        row = forest.start_focus(conn, user_id=payload.user_id, minutes=payload.minutes)
    except ValueError as err:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(err)) from err
    return FocusOut(**dict(row))


@router.post("/focus/{session_id}/complete", response_model=FocusOut)
def complete_focus(
    session_id: str, user_id: str, conn: sqlite3.Connection = Depends(get_db)
) -> FocusOut:
    """Counts only if the block was really sat through — the elapsed time is
    checked against the clock, not taken from the client."""
    try:
        row = forest.complete_focus(conn, session_id=session_id, user_id=user_id)
    except ValueError as err:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(err)) from err
    return FocusOut(**dict(row))
