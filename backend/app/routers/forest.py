"""HTTP surface for the Forest (spec §8).

Read-only apart from two things the learner can actually decide: spending
sunlight, and sitting a focus session. Everything else on this screen is a
projection of their vocabulary and is not writable by design.
"""

import sqlite3

from fastapi import APIRouter, Depends, HTTPException, status

from app.db import get_db
from app.models.forest import (
    BiomeOut,
    FocusOut,
    FocusStartIn,
    ForestOut,
    SpendIn,
    SpendOut,
    TreeOut,
)
from app.services import forest

router = APIRouter(prefix="/forest", tags=["forest"])


@router.get("", response_model=ForestOut)
def get_forest(user_id: str, conn: sqlite3.Connection = Depends(get_db)) -> ForestOut:
    data = forest.summary(conn, user_id)
    return ForestOut(
        trees=[TreeOut(**vars(t)) for t in data["trees"]],
        biomes=[
            BiomeOut(key=key, label=meta["label"], blurb=meta["blurb"], count=data["biomes"].get(key, 0))
            for key, meta in forest.BIOMES.items()
        ],
        stages=data["stages"],
        stage_names=list(forest.STAGES),
        sunlight=data["sunlight"],
        sunlight_earned=data["sunlight_earned"],
        streak_freezes=data["streak_freezes"],
        dormant=data["dormant"],
        costs=data["costs"],
    )


@router.post("/spend", response_model=SpendOut)
def spend(payload: SpendIn, conn: sqlite3.Connection = Depends(get_db)) -> SpendOut:
    try:
        result = forest.spend(
            conn, user_id=payload.user_id, kind=payload.kind, vocab_word_id=payload.vocab_word_id
        )
    except ValueError as err:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(err)) from err
    return SpendOut(**result)


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
    """Pays out only if the block was really sat through — the elapsed time is
    checked against the clock, not taken from the client."""
    try:
        row = forest.complete_focus(conn, session_id=session_id, user_id=user_id)
    except ValueError as err:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(err)) from err
    return FocusOut(**dict(row))
