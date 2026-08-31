import json
import sqlite3

from fastapi import APIRouter, Depends, HTTPException, status

from app.db import get_db
from app.models.onboarding import (
    CompanionUpdate,
    PlacementUpdate,
    UserCreate,
    UserOut,
    UserSettingsUpdate,
)
from app.security import require_token
from app.utils.ids import uuid7
from app.utils.time import iso8601_utc_now

router = APIRouter(prefix="/users", dependencies=[Depends(require_token)])


def _row_to_user(row: sqlite3.Row) -> UserOut:
    return UserOut(
        id=row["id"],
        display_name=row["display_name"],
        native_language=row["native_language"],
        target_language=row["target_language"],
        cefr_level=row["cefr_level"],
        created_at=row["created_at"],
        onboarding_completed_at=row["onboarding_completed_at"],
    )


def _get_user_row(conn: sqlite3.Connection, user_id: str) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return row


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user(payload: UserCreate, conn: sqlite3.Connection = Depends(get_db)) -> UserOut:
    user_id = uuid7()
    created_at = iso8601_utc_now()
    conn.execute(
        """
        INSERT INTO users (id, display_name, native_language, target_language, created_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        (user_id, payload.display_name, payload.native_language, payload.target_language, created_at),
    )
    row = _get_user_row(conn, user_id)
    return _row_to_user(row)


@router.get("/{user_id}", response_model=UserOut)
def get_user(user_id: str, conn: sqlite3.Connection = Depends(get_db)) -> UserOut:
    return _row_to_user(_get_user_row(conn, user_id))


@router.patch("/{user_id}/placement", response_model=UserOut)
def update_placement(
    user_id: str, payload: PlacementUpdate, conn: sqlite3.Connection = Depends(get_db)
) -> UserOut:
    _get_user_row(conn, user_id)
    conn.execute("UPDATE users SET cefr_level = ? WHERE id = ?", (payload.cefr_level, user_id))
    return _row_to_user(_get_user_row(conn, user_id))


@router.put("/{user_id}/settings", status_code=status.HTTP_204_NO_CONTENT)
def update_settings(
    user_id: str, payload: UserSettingsUpdate, conn: sqlite3.Connection = Depends(get_db)
) -> None:
    _get_user_row(conn, user_id)
    conn.execute(
        """
        INSERT INTO user_settings (
          user_id, llm_mode, llm_model_id, api_provider, api_key_ref,
          daily_goal_spec, notifications_enabled, quiet_hours_start, quiet_hours_end
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          llm_mode = excluded.llm_mode,
          llm_model_id = excluded.llm_model_id,
          api_provider = excluded.api_provider,
          api_key_ref = excluded.api_key_ref,
          daily_goal_spec = excluded.daily_goal_spec,
          notifications_enabled = excluded.notifications_enabled,
          quiet_hours_start = excluded.quiet_hours_start,
          quiet_hours_end = excluded.quiet_hours_end
        """,
        (
            user_id,
            payload.llm_mode,
            payload.llm_model_id,
            payload.api_provider,
            payload.api_key_ref,
            json.dumps(payload.daily_goal_spec.model_dump()),
            int(payload.notifications_enabled),
            payload.quiet_hours_start,
            payload.quiet_hours_end,
        ),
    )


@router.post("/{user_id}/companion", status_code=status.HTTP_204_NO_CONTENT)
def set_companion(
    user_id: str, payload: CompanionUpdate, conn: sqlite3.Connection = Depends(get_db)
) -> None:
    """Companion/biome (spec §10.8 player_profiles/biomes) has no dedicated table
    in this increment's scope — stashed in app_meta as a documented placeholder
    until the gamification tables are built (owned by Foyez per spec §12).
    """
    _get_user_row(conn, user_id)
    conn.execute(
        "INSERT INTO app_meta (key, value) VALUES (?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (f"user:{user_id}:companion_species", payload.companion_species),
    )
    conn.execute(
        "INSERT INTO app_meta (key, value) VALUES (?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (f"user:{user_id}:starting_biome", payload.starting_biome),
    )


@router.post("/{user_id}/onboarding/complete", response_model=UserOut)
def complete_onboarding(user_id: str, conn: sqlite3.Connection = Depends(get_db)) -> UserOut:
    _get_user_row(conn, user_id)
    conn.execute(
        "UPDATE users SET onboarding_completed_at = ? WHERE id = ?",
        (iso8601_utc_now(), user_id),
    )
    return _row_to_user(_get_user_row(conn, user_id))
