"""Request/response shapes for "Learn by watching" (spec §4.1, §4.2)."""

from typing import Literal

from pydantic import BaseModel, Field

MediaKind = Literal["local", "link"]
IngestStatus = Literal["queued", "probing", "ready", "failed"]
TrackKind = Literal["subtitle", "audio"]
TrackOrigin = Literal["embedded", "sidecar", "generated"]
TrackRole = Literal["target", "native"]
TrackStatus = Literal["queued", "extracting", "transcribing", "ready", "failed"]
ClipStatus = Literal["queued", "extracting", "ready", "failed", "virtual"]
LibraryScope = Literal["all", "local", "link", "unfinished", "unwatched", "no-subs"]


class MediaImportRequest(BaseModel):
    user_id: str
    paths: list[str]


class MediaItemOut(BaseModel):
    id: str
    user_id: str
    title: str
    kind: MediaKind
    source_path: str | None
    url: str | None
    container: str | None
    duration_ms: int
    width: int | None
    height: int | None
    video_codec: str | None
    audio_codec: str | None
    file_bytes: int
    has_thumbnail: bool
    ingest_status: IngestStatus
    ingest_error: str | None
    source_missing: bool
    # True when the MP4 index follows the media data, which makes seeking slow
    # in any player. Fixable losslessly — see /media/{id}/optimize.
    index_at_end: bool = False
    added_at: str
    # Joined progress. None rather than 0 when never opened — "not started"
    # and "restarted from the beginning" are different facts.
    position_ms: int | None = None
    percent_complete: float | None = None
    total_watch_ms: int | None = None
    last_watched_at: str | None = None
    saves: int = 0
    subtitle_tracks: int = 0


class MediaTrackOut(BaseModel):
    id: str
    kind: TrackKind
    origin: TrackOrigin
    language: str | None
    label: str
    stream_index: int | None
    role: TrackRole
    cue_count: int
    status: TrackStatus
    progress: float
    error: str | None


class CueOut(BaseModel):
    id: str
    order_index: int
    start_ms: int
    end_ms: int
    text: str


class MediaItemPrefsOut(BaseModel):
    target_track_id: str | None = None
    native_track_id: str | None = None
    audio_track_index: int | None = None
    subtitle_delay_ms: int = 0
    playback_rate: float = 1.0


class MediaItemPrefsUpdate(BaseModel):
    target_track_id: str | None = None
    native_track_id: str | None = None
    audio_track_index: int | None = None
    subtitle_delay_ms: int | None = None
    playback_rate: float | None = None


class MediaDetailOut(BaseModel):
    item: MediaItemOut
    tracks: list[MediaTrackOut]
    prefs: MediaItemPrefsOut


class LibraryOut(BaseModel):
    items: list[MediaItemOut]
    recent: list[MediaItemOut]
    counts: dict[str, int]
    ffmpeg_available: bool
    stt_ready: bool
    library_bytes: int


class ProgressUpdate(BaseModel):
    user_id: str
    position_ms: int = Field(ge=0)
    # How much real playback happened since the last beat, not since the file
    # was opened — a seek must not be counted as time watched.
    watched_delta_ms: int = Field(default=0, ge=0)


class ProgressOut(BaseModel):
    position_ms: int
    percent_complete: float
    total_watch_ms: int
    updated_at: str


class SidecarImportRequest(BaseModel):
    path: str
    role: TrackRole = "target"
    language: str | None = None


class GenerateTrackRequest(BaseModel):
    user_id: str
    language: str = "en"


class RelinkRequest(BaseModel):
    path: str


class MediaTitleUpdate(BaseModel):
    title: str = Field(min_length=1, max_length=300)


class SaveFromVideoRequest(BaseModel):
    """Spec §4.1.2 "save with context". Everything the lookup panel is
    showing travels with the save, so the entry is complete the moment it is
    created rather than needing a second round trip to the dictionary."""

    user_id: str
    word: str
    cue_id: str | None = None
    # Present for a drag-selected phrase, which has no single cue token.
    cue_text: str
    start_ms: int = Field(ge=0)
    end_ms: int = Field(ge=0)
    pos: str = ""
    definition: str = ""
    example: str | None = None
    synonyms: list[str] = []
    ipa: str | None = None
    audio_url: str | None = None
    note: str | None = None
    ai_definition: str | None = None
    ai_examples: list[str] = []
    ai_mnemonic: str | None = None
    ai_usage_note: str | None = None
    ai_sense_definition: str | None = None


class ClipOut(BaseModel):
    id: str
    media_item_id: str
    media_title: str
    vocab_word_id: str | None
    cue_text: str
    start_ms: int
    end_ms: int
    status: ClipStatus
    error: str | None
    clip_bytes: int
    has_thumbnail: bool
    created_at: str


class SaveFromVideoOut(BaseModel):
    vocab_word_id: str
    word: str
    already_saved: bool
    context_added: bool
    clip: ClipOut | None


class PlayerPrefsOut(BaseModel):
    # Whether subtitles are drawn at all. Defaulted so a settings row written
    # before this existed still validates rather than 500-ing the player.
    subs_on: bool = True
    dual_subs: bool
    blur_subs: bool
    auto_pause: bool
    loop_cue: bool
    sub_size: float
    sub_opacity: float
    sub_offset: float
    clip_pad_before_ms: int
    clip_pad_after_ms: int
    clip_max_ms: int
    clip_height: int
    # Spec §4.2 storage policy. False keeps only the source path and the
    # timecodes, and the clip is rebuilt from the original when asked for.
    clip_store_files: bool


class PlayerPrefsUpdate(BaseModel):
    subs_on: bool | None = None
    dual_subs: bool | None = None
    blur_subs: bool | None = None
    auto_pause: bool | None = None
    loop_cue: bool | None = None
    sub_size: float | None = None
    sub_opacity: float | None = None
    sub_offset: float | None = None
    clip_pad_before_ms: int | None = None
    clip_pad_after_ms: int | None = None
    clip_max_ms: int | None = None
    clip_height: int | None = None
    clip_store_files: bool | None = None


class MediaStorageOut(BaseModel):
    """What the watching feature is costing, and what it found to work with."""

    clips: int
    stored_clips: int
    clip_bytes: int
    total_bytes: int
    ffmpeg_available: bool
    ffmpeg_version: str | None
    stt_ready: bool
