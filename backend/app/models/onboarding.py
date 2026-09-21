from typing import Literal

from pydantic import BaseModel


class UserCreate(BaseModel):
    display_name: str
    native_language: str
    target_language: str
    # No DB column for this per spec §10.2 — echoed back only; the Electron
    # main process persists it client-side (userData config), not in SQLite.
    data_folder: str


class UserOut(BaseModel):
    id: str
    display_name: str
    native_language: str
    target_language: str
    cefr_level: str | None
    created_at: str
    onboarding_completed_at: str | None
    #: Whether a profile picture has been set. The file itself is served from
    #: /users/{id}/avatar; the path it lives at is nobody's business but the
    #: backend's.
    has_avatar: bool = False


class ProfileUpdate(BaseModel):
    """Editing who you are, after onboarding is over.

    Every field optional: the settings screen saves one row at a time, and a
    patch that insisted on all of them would make changing a display name a
    chance to overwrite a language by accident.
    """

    display_name: str | None = None
    native_language: str | None = None
    target_language: str | None = None
    cefr_level: str | None = None


class AvatarIn(BaseModel):
    """A picture already on this machine.

    A path rather than an upload, because that is how every other file gets
    into FluencyOS: the reader picks it in their own file dialog and the app
    copies it in.
    """

    path: str


class PlacementUpdate(BaseModel):
    cefr_level: str


class GoalItem(BaseModel):
    enabled: bool
    target: int  # unit depends on the goal: cards, minutes, or words


class DailyGoalSpec(BaseModel):
    reviews_cleared: GoalItem  # target = due flashcards to clear
    conversation_minutes: GoalItem  # target = minutes of conversation practice
    watch_minutes: GoalItem  # target = minutes of video/media watched
    reading_minutes: GoalItem  # target = minutes of reading
    new_words: GoalItem  # target = new words/phrases saved


class UserSettingsUpdate(BaseModel):
    llm_mode: Literal["local", "api"]
    llm_model_id: str | None = None
    api_provider: str | None = None
    # Placeholder only — NEVER a raw API key (spec NFR-10: OS keychain only).
    api_key_ref: str | None = None
    daily_goal_spec: DailyGoalSpec
    notifications_enabled: bool
    quiet_hours_start: str
    quiet_hours_end: str


class CompanionUpdate(BaseModel):
    companion_species: Literal["fox", "owl", "deer", "cat"]
    starting_biome: str
