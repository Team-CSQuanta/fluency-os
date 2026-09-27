import sqlite3
from dataclasses import asdict

from fastapi import APIRouter, Depends, HTTPException, status

from app.db import get_db
from app.models.level_test import (
    LevelAttemptOut,
    LevelMoveDownIn,
    LevelTestOverviewOut,
    LevelTestResultOut,
    LevelTestStartIn,
    LevelTestSubmitIn,
)
from app.security import require_token
from app.services import level_test

router = APIRouter(prefix="/level-test", dependencies=[Depends(require_token)])


def _refuse(err: Exception) -> HTTPException:
    if isinstance(err, LookupError):
        return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(err))


@router.get("", response_model=LevelTestOverviewOut)
def get_overview(user_id: str, conn: sqlite3.Connection = Depends(get_db)) -> LevelTestOverviewOut:
    try:
        return LevelTestOverviewOut(**level_test.overview(conn, user_id))
    except LookupError as err:
        raise _refuse(err) from err


@router.post("/attempts", response_model=LevelAttemptOut, status_code=status.HTTP_201_CREATED)
def start_attempt(payload: LevelTestStartIn, conn: sqlite3.Connection = Depends(get_db)) -> LevelAttemptOut:
    """A fresh test for a level above the learner's own."""
    try:
        return LevelAttemptOut(**level_test.start(conn, payload.user_id, payload.level))
    except (LookupError, level_test.LevelTestError) as err:
        raise _refuse(err) from err


@router.post("/attempts/{attempt_id}/submit", response_model=LevelTestResultOut)
def submit_attempt(
    attempt_id: str, payload: LevelTestSubmitIn, conn: sqlite3.Connection = Depends(get_db)
) -> LevelTestResultOut:
    """Marked here, against answers the client never saw. A pass moves the
    learner up to the level tested."""
    try:
        return LevelTestResultOut(**asdict(level_test.submit(conn, payload.user_id, attempt_id, payload.answers)))
    except (LookupError, level_test.LevelTestError) as err:
        raise _refuse(err) from err


@router.post("/move-down", response_model=LevelTestOverviewOut)
def move_down(payload: LevelMoveDownIn, conn: sqlite3.Connection = Depends(get_db)) -> LevelTestOverviewOut:
    """Down never needs a test."""
    try:
        level_test.move_down(conn, payload.user_id, payload.level)
        return LevelTestOverviewOut(**level_test.overview(conn, payload.user_id))
    except (LookupError, level_test.LevelTestError) as err:
        raise _refuse(err) from err
