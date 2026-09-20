"""The settings page's own payload.

Deliberately not the whole `user_settings` row. Three kinds of column live in
that table and only one of them belongs here:

  * settings this page owns and writes — study targets, notifications, how
    hands-free listening behaves;
  * settings another screen owns, which appear here READ-ONLY so the page can
    say what they are without becoming a second place to change them: the
    player and reader write theirs through /media/prefs/player and
    /reading/prefs, where the controls sit next to the thing they affect;
  * secrets, which never leave the machine in either direction. An API key is
    reported as set or not set, never echoed back.
"""

from typing import Literal

from pydantic import BaseModel, Field

MicSensitivity = Literal["sensitive", "balanced", "robust"]
TurnPace = Literal["quick", "natural", "patient"]


class AppSettingsOut(BaseModel):
    # --- owned here -------------------------------------------------------
    target_retention: float
    new_cards_per_day: int
    daily_page_goal: int
    notifications_enabled: bool
    quiet_hours_start: str
    quiet_hours_end: str
    conversation_mic_sensitivity: MicSensitivity
    conversation_turn_pace: TurnPace
    scene_embeds_enabled: bool

    # --- owned elsewhere, shown so the page can report the truth ----------
    llm_mode: str
    llm_model_id: str | None
    api_provider: str | None
    openrouter_model: str | None
    gemini_model: str | None
    tts_engine: str
    stt_model_id: str | None
    #: Whether a key exists, never the key. The page shows "set" or "not set"
    #: and sends you to the AI panel to change it.
    openrouter_key_set: bool
    gemini_key_set: bool


class AppSettingsPatch(BaseModel):
    """Every field optional: the page saves one control at a time, and a whole
    -row write is how the reader's font size used to be able to wipe the LLM
    configuration (see the note on PUT /reading/prefs)."""

    # FSRS's useful range. Below 0.70 the schedule stops being a schedule;
    # above 0.97 it asks for a review almost every day and never lets go.
    target_retention: float | None = Field(default=None, ge=0.70, le=0.97)
    new_cards_per_day: int | None = Field(default=None, ge=0, le=200)
    daily_page_goal: int | None = Field(default=None, ge=0, le=500)
    notifications_enabled: bool | None = None
    quiet_hours_start: str | None = Field(default=None, pattern=r"^\d{2}:\d{2}$")
    quiet_hours_end: str | None = Field(default=None, pattern=r"^\d{2}:\d{2}$")
    conversation_mic_sensitivity: MicSensitivity | None = None
    conversation_turn_pace: TurnPace | None = None
    scene_embeds_enabled: bool | None = None
