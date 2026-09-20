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
from app.models.settings import AppSettingsOut, AppSettingsPatch
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


# --------------------------------------------------------------------------
# The settings page.
#
# The onboarding PUT above writes the whole row from one payload, which is
# right for onboarding — it is filling the row in — and wrong for everything
# afterwards. A settings page changes one control at a time, and a whole-row
# write from a page that did not display every column would quietly reset the
# ones it left out.


def _settings_row(conn: sqlite3.Connection, user_id: str) -> sqlite3.Row:
    """This user's settings, created with the schema's own defaults if the row
    is missing. Skipping onboarding is allowed, so absence is not an error."""
    _get_user_row(conn, user_id)
    conn.execute(
        "INSERT INTO user_settings (user_id) VALUES (?) ON CONFLICT(user_id) DO NOTHING",
        (user_id,),
    )
    return conn.execute("SELECT * FROM user_settings WHERE user_id = ?", (user_id,)).fetchone()


@router.get("/{user_id}/settings", response_model=AppSettingsOut)
def get_settings(user_id: str, conn: sqlite3.Connection = Depends(get_db)) -> AppSettingsOut:
    """Everything the settings page shows.

    Until this existed the page had no way to read its own values, so it
    displayed a hard-coded list — "MacBook Mic", "18.4 GB used", "af_heart" —
    for a user whose microphone, disk and voice were all something else.
    """
    row = _settings_row(conn, user_id)
    return AppSettingsOut(
        target_retention=row["target_retention_srs"],
        new_cards_per_day=row["new_cards_per_day"],
        daily_page_goal=row["daily_page_goal"],
        notifications_enabled=bool(row["notifications_enabled"]),
        quiet_hours_start=row["quiet_hours_start"] or "22:00",
        quiet_hours_end=row["quiet_hours_end"] or "08:00",
        conversation_mic_sensitivity=row["conversation_mic_sensitivity"],
        conversation_turn_pace=row["conversation_turn_pace"],
        scene_embeds_enabled=bool(row["scene_embeds_enabled"]),
        llm_mode=row["llm_mode"],
        llm_model_id=row["llm_model_id"],
        api_provider=row["api_provider"],
        openrouter_model=row["openrouter_model"],
        gemini_model=row["gemini_model"],
        tts_engine=row["tts_engine"],
        stt_model_id=row["stt_model_id"],
        # The keys themselves stay on the machine. Whether one is set is not a
        # secret, and the page needs it to say "set" rather than showing a box
        # that looks empty when it is not.
        openrouter_key_set=bool(row["openrouter_api_key"]),
        gemini_key_set=bool(row["gemini_api_key"]),
    )


#: Payload field -> column. Only the settings this page owns; the player's and
#: the reader's are written where their controls live.
_PATCHABLE = {
    "target_retention": "target_retention_srs",
    "new_cards_per_day": "new_cards_per_day",
    "daily_page_goal": "daily_page_goal",
    "notifications_enabled": "notifications_enabled",
    "quiet_hours_start": "quiet_hours_start",
    "quiet_hours_end": "quiet_hours_end",
    "conversation_mic_sensitivity": "conversation_mic_sensitivity",
    "conversation_turn_pace": "conversation_turn_pace",
    "scene_embeds_enabled": "scene_embeds_enabled",
}
_BOOL_SETTINGS = {"notifications_enabled", "scene_embeds_enabled"}


@router.patch("/{user_id}/settings", response_model=AppSettingsOut)
def patch_settings(
    user_id: str, payload: AppSettingsPatch, conn: sqlite3.Connection = Depends(get_db)
) -> AppSettingsOut:
    """Change only what was sent, and answer with the whole settings object so
    the page never has to guess what the row now holds."""
    _settings_row(conn, user_id)
    fields = payload.model_dump(exclude_unset=True)
    # exclude_unset keeps "not mentioned" apart from "set to null"; an explicit
    # null for any of these would be a bad write, so it is dropped either way.
    fields = {k: v for k, v in fields.items() if v is not None}
    if fields:
        assignments = ", ".join(f"{_PATCHABLE[name]} = ?" for name in fields)
        values = [int(v) if name in _BOOL_SETTINGS else v for name, v in fields.items()]
        conn.execute(
            f"UPDATE user_settings SET {assignments} WHERE user_id = ?", (*values, user_id)
        )
    return get_settings(user_id, conn)


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
