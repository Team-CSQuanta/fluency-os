"""Learn by watching — library, player, subtitle tracks and the clip engine.

Route-level notes worth carrying:

* /stream and the thumbnail/clip file routes authenticate with
  require_token_or_query, because the browser fetches them directly. Every
  other route here uses the normal header dependency.
* Work that touches ffmpeg or Whisper is queued onto BackgroundTasks with its
  own connection, never done inline — spec §4.1.3 is explicit that saving a
  word must not block playback, and the same applies to importing.
"""

import mimetypes
import sqlite3
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from fastapi.responses import FileResponse

from app.db import get_connection, get_db
from app.models.media import (
    ClipOut,
    CueOut,
    GenerateTrackRequest,
    LibraryOut,
    MediaDetailOut,
    MediaImportRequest,
    MediaItemOut,
    MediaItemPrefsOut,
    MediaItemPrefsUpdate,
    MediaStorageOut,
    MediaTitleUpdate,
    MediaTrackOut,
    PlayerPrefsOut,
    PlayerPrefsUpdate,
    ProgressOut,
    ProgressUpdate,
    RelinkRequest,
    SaveFromVideoOut,
    SaveFromVideoRequest,
    SidecarImportRequest,
)
from app.security import require_token, require_token_or_query
from app.services import vocabulary
from app.services.media import (
    clips,
    ffmpeg,
    library,
    optimize,
    probe as probe_mod,
    storage,
    subtitles,
    tracks,
)
from app.services.voice import stt_engine
from app.services.voice.errors import EngineUnavailable
from app.utils.time import iso8601_utc_now

router = APIRouter(prefix="/media", dependencies=[Depends(require_token)])
# Routes the <video>/<img> tag hits directly, where a header is impossible.
file_router = APIRouter(prefix="/media", dependencies=[Depends(require_token_or_query)])

# API name -> user_settings column. The clip_* ones map onto columns
# 0001_init.sql already defined, so the engine reads the settings the schema
# always intended for it rather than a parallel set.
PLAYER_PREF_COLUMNS = {
    "dual_subs": "player_dual_subs",
    "blur_subs": "player_blur_subs",
    "auto_pause": "player_auto_pause",
    "loop_cue": "player_loop_cue",
    "sub_size": "player_sub_size",
    "sub_opacity": "player_sub_opacity",
    "sub_offset": "player_sub_offset",
    "clip_pad_before_ms": "clip_padding_before_ms",
    "clip_pad_after_ms": "clip_padding_after_ms",
    "clip_max_ms": "clip_max_ms",
}
_BOOL_PREFS = {"dual_subs", "blur_subs", "auto_pause", "loop_cue"}


def _clip_height(settings_row: sqlite3.Row) -> int:
    """clip_resolution is stored as '480p'. Parsed rather than assumed so a
    user who set 720p gets 720p."""
    raw = (settings_row["clip_resolution"] or "480p").strip().lower().rstrip("p")
    return int(raw) if raw.isdigit() else 480


def _clip_store_files(settings_row: sqlite3.Row) -> bool:
    return (settings_row["clip_storage_mode"] or "store") == "store"


# --------------------------------------------------------------------------
# row -> model


def _item_out(row: sqlite3.Row) -> MediaItemOut:
    keys = row.keys()
    optional = lambda name: row[name] if name in keys else None  # noqa: E731
    return MediaItemOut(
        id=row["id"],
        user_id=row["user_id"],
        title=row["title"],
        kind=row["kind"],
        source_path=row["source_path"],
        url=row["url"],
        container=row["container"],
        duration_ms=row["duration_ms"],
        width=row["width"],
        height=row["height"],
        video_codec=row["video_codec"],
        audio_codec=row["audio_codec"],
        file_bytes=row["file_bytes"],
        has_thumbnail=bool(row["thumbnail_path"]),
        ingest_status=row["ingest_status"],
        ingest_error=row["ingest_error"],
        source_missing=bool(row["source_missing"]),
        index_at_end=bool(optional("index_at_end")),
        added_at=row["added_at"],
        position_ms=optional("position_ms"),
        percent_complete=optional("percent_complete"),
        total_watch_ms=optional("total_watch_ms"),
        last_watched_at=optional("last_watched_at"),
        saves=optional("saves") or 0,
        subtitle_tracks=optional("subtitle_tracks") or 0,
    )


def _track_out(row: sqlite3.Row) -> MediaTrackOut:
    return MediaTrackOut(
        id=row["id"],
        kind=row["kind"],
        origin=row["origin"],
        language=row["language"],
        label=row["label"],
        stream_index=row["stream_index"],
        role=row["role"],
        cue_count=row["cue_count"],
        status=row["status"],
        progress=row["progress"],
        error=row["error"],
    )


def _clip_out(row: sqlite3.Row) -> ClipOut:
    keys = row.keys()
    return ClipOut(
        id=row["id"],
        media_item_id=row["media_item_id"],
        media_title=row["media_title"] if "media_title" in keys else "",
        vocab_word_id=row["vocab_word_id"],
        cue_text=row["cue_text"],
        start_ms=row["start_ms"],
        end_ms=row["end_ms"],
        status=row["status"],
        error=row["error"],
        clip_bytes=row["clip_bytes"],
        has_thumbnail=bool(row["thumb_path"]),
        created_at=row["created_at"],
    )


def _prefs_out(row: sqlite3.Row | None) -> MediaItemPrefsOut:
    if row is None:
        return MediaItemPrefsOut()
    return MediaItemPrefsOut(
        target_track_id=row["target_track_id"],
        native_track_id=row["native_track_id"],
        audio_track_index=row["audio_track_index"],
        subtitle_delay_ms=row["subtitle_delay_ms"],
        playback_rate=row["playback_rate"],
    )


def _require_item(conn: sqlite3.Connection, media_id: str) -> sqlite3.Row:
    row = library.get_item(conn, media_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Media item not found")
    return row


# --------------------------------------------------------------------------
# import & library


def _ingest_in_background(media_id: str) -> None:
    conn = get_connection()
    try:
        library.run_ingest(conn, media_id)
    finally:
        conn.close()


@router.post("/import", status_code=status.HTTP_202_ACCEPTED, response_model=list[MediaItemOut])
def import_media(
    payload: MediaImportRequest,
    background_tasks: BackgroundTasks,
    conn: sqlite3.Connection = Depends(get_db),
) -> list[MediaItemOut]:
    if not ffmpeg.is_available():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="ffmpeg wasn't found on this machine — install it (or set FLUENCYOS_FFMPEG_DIR) "
            "and restart FluencyOS. Videos can't be read without it.",
        )

    out: list[sqlite3.Row] = []
    queued: list[str] = []

    for raw in payload.paths:
        path = Path(raw).expanduser()
        if not path.is_file():
            out.append(_require_item(conn, library.create_failed(
                conn, user_id=payload.user_id, raw_path=raw, reason="File not found or unreadable."
            )))
            continue
        if path.suffix.lower() not in probe_mod.VIDEO_SUFFIXES:
            out.append(_require_item(conn, library.create_failed(
                conn, user_id=payload.user_id, raw_path=raw,
                reason=f"{path.suffix or 'This file'} isn't a video format FluencyOS can play.",
            )))
            continue

        file_hash = probe_mod.quick_hash(path)
        existing = library.find_existing(conn, payload.user_id, file_hash)
        if existing is not None:
            out.append(_require_item(conn, existing["id"]))
            continue

        media_id = library.create_queued(conn, user_id=payload.user_id, source_path=path, file_hash=file_hash)
        out.append(_require_item(conn, media_id))
        queued.append(media_id)

    # Same ordering constraint books.import_books documents: get_db commits
    # after BackgroundTasks run, so the queued rows must be committed here or
    # the ingest task's own connection won't find them.
    conn.commit()
    for media_id in queued:
        background_tasks.add_task(_ingest_in_background, media_id)

    return [_item_out(r) for r in out]


@router.get("", response_model=LibraryOut)
def get_library(
    user_id: str,
    scope: str = "all",
    q: str | None = None,
    conn: sqlite3.Connection = Depends(get_db),
) -> LibraryOut:
    return LibraryOut(
        items=[_item_out(r) for r in library.list_items(conn, user_id, scope=scope, query=q)],
        recent=[_item_out(r) for r in library.recent(conn, user_id)],
        counts=library.counts(conn, user_id),
        ffmpeg_available=ffmpeg.is_available(),
        stt_ready=_stt_downloaded(),
        library_bytes=storage.library_bytes(),
    )


def _stt_downloaded() -> bool:
    """Whether subtitle generation is offerable — the model being on disk,
    not loaded. Loading is this feature's job, not the user's."""
    from app.services.voice import model_manager

    cache = model_manager.whisper_cache_dir()
    return any(cache.glob(f"models--Systran--faster-whisper-{stt_engine.MODEL_SIZE}/**/model.bin"))


# Declared before /media/{media_id}: FastAPI matches in registration order,
# and a literal second segment loses to a path parameter that was defined
# first — /media/storage would otherwise be read as a media id.
@router.get("/storage", response_model=MediaStorageOut)
def storage_summary(user_id: str, conn: sqlite3.Connection = Depends(get_db)) -> MediaStorageOut:
    """What this feature is costing on disk (spec §4.2 "library size
    indicator"), and what ffmpeg it found."""
    row = conn.execute(
        """
        SELECT COUNT(*) AS total,
               SUM(CASE WHEN c.status = 'ready' THEN 1 ELSE 0 END) AS stored,
               COALESCE(SUM(c.clip_bytes), 0) AS bytes
          FROM media_clips c JOIN media_items m ON m.id = c.media_item_id
         WHERE m.user_id = ?
        """,
        (user_id,),
    ).fetchone()
    return MediaStorageOut(
        clips=row["total"] or 0,
        stored_clips=row["stored"] or 0,
        clip_bytes=row["bytes"] or 0,
        total_bytes=storage.library_bytes(),
        ffmpeg_available=ffmpeg.is_available(),
        ffmpeg_version=ffmpeg.version(),
        stt_ready=_stt_downloaded(),
    )


@router.get("/{media_id}", response_model=MediaDetailOut)
def get_media(media_id: str, conn: sqlite3.Connection = Depends(get_db)) -> MediaDetailOut:
    row = _require_item(conn, media_id)
    library.refresh_source_state(conn, row)
    row = _require_item(conn, media_id)
    track_rows = conn.execute(
        "SELECT * FROM media_tracks WHERE media_item_id = ? ORDER BY kind, created_at", (media_id,)
    ).fetchall()
    prefs = conn.execute("SELECT * FROM media_item_prefs WHERE media_item_id = ?", (media_id,)).fetchone()
    return MediaDetailOut(
        item=_item_out(row), tracks=[_track_out(t) for t in track_rows], prefs=_prefs_out(prefs)
    )


@router.patch("/{media_id}", response_model=MediaItemOut)
def rename_media(
    media_id: str, payload: MediaTitleUpdate, conn: sqlite3.Connection = Depends(get_db)
) -> MediaItemOut:
    _require_item(conn, media_id)
    conn.execute("UPDATE media_items SET title = ? WHERE id = ?", (payload.title.strip(), media_id))
    return _item_out(_require_item(conn, media_id))


@router.post("/{media_id}/relink", response_model=MediaItemOut)
def relink_media(
    media_id: str,
    payload: RelinkRequest,
    background_tasks: BackgroundTasks,
    conn: sqlite3.Connection = Depends(get_db),
) -> MediaItemOut:
    """Point an entry at the file's new location (spec §4.2 "Fallback")."""
    _require_item(conn, media_id)
    path = Path(payload.path).expanduser()
    if not path.is_file():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="That path isn't a readable file.")
    library.relink(conn, media_id, path)
    conn.commit()
    background_tasks.add_task(_ingest_in_background, media_id)
    return _item_out(_require_item(conn, media_id))


def _optimize_in_background(media_id: str) -> None:
    conn = get_connection()
    try:
        optimize.run_job(conn, media_id)
    finally:
        conn.close()


@router.post("/{media_id}/optimize", status_code=status.HTTP_202_ACCEPTED, response_model=MediaItemOut)
def optimize_for_seeking(
    media_id: str, background_tasks: BackgroundTasks, conn: sqlite3.Connection = Depends(get_db)
) -> MediaItemOut:
    """Move an MP4's seek index to the front of the file.

    Rewrites a file the learner owns, so it is never automatic — the library
    flags the condition and this runs only when they ask. The streams are
    copied, not re-encoded, and the original is replaced only after the
    rewritten file has been checked (see optimize.remux_faststart).
    """
    row = _require_item(conn, media_id)
    if not row["source_path"] or not Path(row["source_path"]).is_file():
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="The source file is missing — relink it first.")
    if not row["index_at_end"]:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="This file's index is already at the front."
        )
    conn.commit()
    background_tasks.add_task(_optimize_in_background, media_id)
    return _item_out(_require_item(conn, media_id))


@router.delete("/{media_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_media(media_id: str, conn: sqlite3.Connection = Depends(get_db)) -> None:
    _require_item(conn, media_id)
    library.delete_item(conn, media_id)


@router.post("/{media_id}/reingest", status_code=status.HTTP_202_ACCEPTED, response_model=MediaItemOut)
def reingest(
    media_id: str, background_tasks: BackgroundTasks, conn: sqlite3.Connection = Depends(get_db)
) -> MediaItemOut:
    row = _require_item(conn, media_id)
    conn.execute("UPDATE media_items SET ingest_status = 'queued', ingest_error = NULL WHERE id = ?", (media_id,))
    # Embedded tracks are re-derived by the ingest; sidecars and generated
    # tracks are not, and dropping them would throw away a Whisper run.
    conn.execute("DELETE FROM media_tracks WHERE media_item_id = ? AND origin = 'embedded'", (media_id,))
    conn.commit()
    background_tasks.add_task(_ingest_in_background, media_id)
    return _item_out(_require_item(conn, row["id"]))


# --------------------------------------------------------------------------
# playback


@file_router.get("/{media_id}/stream")
def stream(media_id: str, conn: sqlite3.Connection = Depends(get_db)) -> FileResponse:
    """The video itself, served with byte-range support so <video> can seek.

    FileResponse handles Range in Starlette 1.x; that is the whole reason this
    is a file response rather than a StreamingResponse — without 206 replies a
    two-hour film has to download before it can be scrubbed.
    """
    row = _require_item(conn, media_id)
    path = Path(row["source_path"]) if row["source_path"] else None
    if path is None or not path.is_file():
        library.refresh_source_state(conn, row)
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="The source file is no longer at its saved location — relink it to keep watching.",
        )
    media_type = mimetypes.guess_type(path.name)[0] or "video/mp4"
    return FileResponse(str(path), media_type=media_type, filename=path.name)


@file_router.get("/{media_id}/thumbnail")
def thumbnail(media_id: str, conn: sqlite3.Connection = Depends(get_db)) -> FileResponse:
    row = _require_item(conn, media_id)
    if not row["thumbnail_path"] or not Path(row["thumbnail_path"]).is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No thumbnail for this item")
    return FileResponse(row["thumbnail_path"], media_type="image/jpeg")


@router.put("/{media_id}/progress", response_model=ProgressOut)
def update_progress(
    media_id: str, payload: ProgressUpdate, conn: sqlite3.Connection = Depends(get_db)
) -> ProgressOut:
    row = _require_item(conn, media_id)
    saved = library.save_progress(
        conn,
        media_id=media_id,
        user_id=payload.user_id,
        position_ms=payload.position_ms,
        watched_delta_ms=payload.watched_delta_ms,
        duration_ms=row["duration_ms"],
    )
    return ProgressOut(
        position_ms=saved["position_ms"],
        percent_complete=saved["percent_complete"],
        total_watch_ms=saved["total_watch_ms"],
        updated_at=saved["updated_at"],
    )


@router.put("/{media_id}/prefs", response_model=MediaItemPrefsOut)
def update_item_prefs(
    media_id: str, payload: MediaItemPrefsUpdate, conn: sqlite3.Connection = Depends(get_db)
) -> MediaItemPrefsOut:
    _require_item(conn, media_id)
    conn.execute(
        "INSERT INTO media_item_prefs (media_item_id, updated_at) VALUES (?, ?) "
        "ON CONFLICT(media_item_id) DO NOTHING",
        (media_id, iso8601_utc_now()),
    )
    fields = payload.model_dump(exclude_unset=True)
    if fields:
        assignments = ", ".join(f"{name} = ?" for name in fields)
        conn.execute(
            f"UPDATE media_item_prefs SET {assignments}, updated_at = ? WHERE media_item_id = ?",
            (*fields.values(), iso8601_utc_now(), media_id),
        )
        # role follows the selection, so the dual-subtitle renderer can tell
        # the two tracks apart without re-reading prefs per cue.
        if "native_track_id" in fields and fields["native_track_id"]:
            conn.execute("UPDATE media_tracks SET role = 'native' WHERE id = ?", (fields["native_track_id"],))
        if "target_track_id" in fields and fields["target_track_id"]:
            conn.execute("UPDATE media_tracks SET role = 'target' WHERE id = ?", (fields["target_track_id"],))
    return _prefs_out(conn.execute("SELECT * FROM media_item_prefs WHERE media_item_id = ?", (media_id,)).fetchone())


# --------------------------------------------------------------------------
# subtitle tracks


@router.get("/tracks/{track_id}/cues", response_model=list[CueOut])
def get_cues(track_id: str, conn: sqlite3.Connection = Depends(get_db)) -> list[CueOut]:
    """Every cue for a track, in one response.

    A two-hour film is roughly 1,500 cues — a few hundred kilobytes, fetched
    once when the file opens. Paging them would buy nothing and would put a
    network round trip inside the timeupdate handler, which is the one place
    in this feature that must never wait.
    """
    rows = conn.execute(
        "SELECT * FROM media_cues WHERE track_id = ? ORDER BY order_index", (track_id,)
    ).fetchall()
    return [
        CueOut(
            id=r["id"], order_index=r["order_index"], start_ms=r["start_ms"], end_ms=r["end_ms"], text=r["text"]
        )
        for r in rows
    ]


@router.post("/{media_id}/tracks/sidecar", response_model=MediaTrackOut)
def add_sidecar(
    media_id: str, payload: SidecarImportRequest, conn: sqlite3.Connection = Depends(get_db)
) -> MediaTrackOut:
    _require_item(conn, media_id)
    path = Path(payload.path).expanduser()
    if not path.is_file():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="That subtitle file couldn't be read.")
    try:
        track_id, _count = tracks.import_sidecar(
            conn, media_item_id=media_id, path=path, role=payload.role, language=payload.language
        )
    except subtitles.SubtitleParseError as err:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(err)) from err
    conn.commit()
    library._auto_select_tracks(conn, media_id)
    return _track_out(conn.execute("SELECT * FROM media_tracks WHERE id = ?", (track_id,)).fetchone())


def _generate_in_background(track_id: str, media_id: str, source: str) -> None:
    conn = get_connection()
    try:
        tracks.generate_track(conn, track_id=track_id, video_path=Path(source))
        library._auto_select_tracks(conn, media_id)
        conn.commit()
    except EngineUnavailable as err:
        tracks.set_failed(conn, track_id, str(err))
        conn.commit()
    finally:
        conn.close()


@router.post("/{media_id}/tracks/generate", status_code=status.HTTP_202_ACCEPTED, response_model=MediaTrackOut)
def generate_subtitles(
    media_id: str,
    payload: GenerateTrackRequest,
    background_tasks: BackgroundTasks,
    conn: sqlite3.Connection = Depends(get_db),
) -> MediaTrackOut:
    """Transcribe the file into a `generated` track (spec §4.1.2)."""
    row = _require_item(conn, media_id)
    if not row["source_path"] or not Path(row["source_path"]).is_file():
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="The source file is missing — relink it first.")
    if not _stt_downloaded():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The speech-to-text model isn't downloaded yet — get it in Settings first.",
        )
    if tracks.generation_busy():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Another file is being transcribed — only one can run at a time on this machine.",
        )

    track_id = tracks.create_track(
        conn,
        media_item_id=media_id,
        kind="subtitle",
        origin="generated",
        language=payload.language,
        label=tracks.label_for(origin="generated", language=payload.language, title="whisper", index=None),
        status="queued",
    )
    conn.commit()
    background_tasks.add_task(_generate_in_background, track_id, media_id, row["source_path"])
    return _track_out(conn.execute("SELECT * FROM media_tracks WHERE id = ?", (track_id,)).fetchone())


@router.post("/tracks/{track_id}/cancel", status_code=status.HTTP_202_ACCEPTED)
def cancel_generation(track_id: str) -> dict:
    tracks.request_cancel(track_id)
    return {"cancelling": True}


@router.delete("/tracks/{track_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_track(track_id: str, conn: sqlite3.Connection = Depends(get_db)) -> None:
    row = conn.execute("SELECT * FROM media_tracks WHERE id = ?", (track_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Track not found")
    conn.execute("DELETE FROM media_tracks WHERE id = ?", (track_id,))
    storage.delete_files(str(storage.subtitles_dir() / f"{track_id}.vtt"))


# --------------------------------------------------------------------------
# saving a word, and the clips that follow


def _extract_clip_in_background(clip_id: str, height: int) -> None:
    conn = get_connection()
    try:
        clips.run_job(conn, clip_id, height=height)
    finally:
        conn.close()


def _player_prefs_row(conn: sqlite3.Connection, user_id: str) -> sqlite3.Row:
    """Settings for this user, created with their defaults if absent.

    Onboarding does not always write a settings row (see
    reading_goal.set_daily_goal, which upserts for the same reason), and a
    learner who skipped it must still be able to save a word from a video.
    """
    if conn.execute("SELECT 1 FROM users WHERE id = ?", (user_id,)).fetchone() is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No such user")
    conn.execute("INSERT INTO user_settings (user_id) VALUES (?) ON CONFLICT(user_id) DO NOTHING", (user_id,))
    return conn.execute("SELECT * FROM user_settings WHERE user_id = ?", (user_id,)).fetchone()


@router.post("/{media_id}/save-word", response_model=SaveFromVideoOut)
def save_word_from_video(
    media_id: str,
    payload: SaveFromVideoRequest,
    background_tasks: BackgroundTasks,
    conn: sqlite3.Connection = Depends(get_db),
) -> SaveFromVideoOut:
    """Spec §4.1.2 "save with context" plus §4.2's queued extraction.

    The word, its context and its timecodes are committed synchronously; the
    clip is queued. §4.1.3: saving must never block playback, and a save that
    only half-succeeded because ffmpeg was slow would be worse than no clip.
    """
    item = _require_item(conn, media_id)
    settings_row = _player_prefs_row(conn, payload.user_id)

    word_row, already_saved = vocabulary.save_manual_word(
        conn,
        user_id=payload.user_id,
        word=payload.word,
        pos=payload.pos,
        definition=payload.definition or f"(saved from {item['title']})",
        example=payload.example,
        synonyms=payload.synonyms,
        ipa=payload.ipa,
        audio_url=payload.audio_url,
        note_text=payload.note,
        ai_definition=payload.ai_definition,
        ai_examples=payload.ai_examples,
        ai_mnemonic=payload.ai_mnemonic,
        ai_usage_note=payload.ai_usage_note,
        ai_sense_definition=payload.ai_sense_definition,
    )

    context_id = vocabulary.add_clip_context(
        conn,
        vocab_word_id=word_row["id"],
        media_item_id=media_id,
        media_title=item["title"],
        snippet=payload.cue_text,
        start_ms=payload.start_ms,
        end_ms=payload.end_ms,
        # Travels with the moment so it can find this file again if the
        # library entry is ever removed and the film re-imported.
        media_file_hash=item["file_hash"],
    )

    clip_row = None
    if context_id is not None:
        prev_end = next_start = None
        if payload.cue_id:
            cue = conn.execute("SELECT * FROM media_cues WHERE id = ?", (payload.cue_id,)).fetchone()
            if cue is not None:
                prev_end, next_start = clips.neighbours(conn, cue["track_id"], cue["order_index"])

        window = clips.window_for(
            cue_start_ms=payload.start_ms,
            cue_end_ms=payload.end_ms,
            pad_before_ms=settings_row["clip_padding_before_ms"],
            pad_after_ms=settings_row["clip_padding_after_ms"],
            max_ms=settings_row["clip_max_ms"],
            duration_ms=item["duration_ms"],
            prev_cue_end_ms=prev_end,
            next_cue_start_ms=next_start,
        )
        store_files = _clip_store_files(settings_row)
        clip_id = clips.queue(
            conn,
            media_item_id=media_id,
            vocab_word_id=word_row["id"],
            vocab_context_id=context_id,
            cue_text=payload.cue_text,
            window=window,
            store_file=store_files,
        )
        conn.commit()
        if store_files:
            background_tasks.add_task(_extract_clip_in_background, clip_id, _clip_height(settings_row))
        clip_row = conn.execute(
            "SELECT c.*, m.title AS media_title FROM media_clips c "
            "JOIN media_items m ON m.id = c.media_item_id WHERE c.id = ?",
            (clip_id,),
        ).fetchone()

    return SaveFromVideoOut(
        vocab_word_id=word_row["id"],
        word=word_row["word"],
        already_saved=already_saved,
        context_added=context_id is not None,
        clip=_clip_out(clip_row) if clip_row is not None else None,
    )


@router.get("/clips/list", response_model=list[ClipOut])
def list_clips(
    user_id: str,
    media_id: str | None = None,
    limit: int = Query(default=100, le=500),
    conn: sqlite3.Connection = Depends(get_db),
) -> list[ClipOut]:
    sql = (
        "SELECT c.*, m.title AS media_title FROM media_clips c "
        "JOIN media_items m ON m.id = c.media_item_id WHERE m.user_id = ?"
    )
    params: list[object] = [user_id]
    if media_id:
        sql += " AND c.media_item_id = ?"
        params.append(media_id)
    sql += " ORDER BY c.created_at DESC LIMIT ?"
    params.append(limit)
    return [_clip_out(r) for r in conn.execute(sql, params).fetchall()]


@router.post("/clips/{clip_id}/retry", status_code=status.HTTP_202_ACCEPTED, response_model=ClipOut)
def retry_clip(
    clip_id: str,
    user_id: str,
    background_tasks: BackgroundTasks,
    conn: sqlite3.Connection = Depends(get_db),
) -> ClipOut:
    row = conn.execute(
        "SELECT c.*, m.title AS media_title FROM media_clips c "
        "JOIN media_items m ON m.id = c.media_item_id WHERE c.id = ?",
        (clip_id,),
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Clip not found")
    settings_row = _player_prefs_row(conn, user_id)
    conn.execute("UPDATE media_clips SET status = 'queued', error = NULL WHERE id = ?", (clip_id,))
    conn.commit()
    background_tasks.add_task(_extract_clip_in_background, clip_id, _clip_height(settings_row))
    return _clip_out(
        conn.execute(
            "SELECT c.*, m.title AS media_title FROM media_clips c "
            "JOIN media_items m ON m.id = c.media_item_id WHERE c.id = ?",
            (clip_id,),
        ).fetchone()
    )


@router.delete("/clips/{clip_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_clip(clip_id: str, conn: sqlite3.Connection = Depends(get_db)) -> None:
    row = conn.execute("SELECT * FROM media_clips WHERE id = ?", (clip_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Clip not found")
    conn.execute("DELETE FROM media_clips WHERE id = ?", (clip_id,))
    storage.delete_files(row["clip_path"], row["thumb_path"])


@file_router.get("/clips/{clip_id}/file")
def clip_file(clip_id: str, conn: sqlite3.Connection = Depends(get_db)) -> FileResponse:
    """The stored clip, or — when the storage policy says timecodes only — a
    ranged read of the source at the saved window, which is what spec §4.2
    means by reconstructing on demand."""
    row = conn.execute(
        "SELECT c.*, m.source_path FROM media_clips c JOIN media_items m ON m.id = c.media_item_id WHERE c.id = ?",
        (clip_id,),
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Clip not found")
    if row["clip_path"] and Path(row["clip_path"]).is_file():
        return FileResponse(row["clip_path"], media_type="video/mp4")
    if row["status"] == "virtual" and row["source_path"] and Path(row["source_path"]).is_file():
        clip_path, thumb_path = storage.clip_paths(clip_id)
        try:
            clips.extract(
                source=Path(row["source_path"]),
                window=clips.ClipWindow(start_ms=row["start_ms"], end_ms=row["end_ms"]),
                clip_path=clip_path,
                thumb_path=thumb_path,
            )
        except (ffmpeg.FfmpegUnavailable, ffmpeg.FfmpegFailed) as err:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(err)) from err
        return FileResponse(str(clip_path), media_type="video/mp4")
    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail=row["error"] or "This clip hasn't been extracted yet.",
    )


@router.post("/clips/purge-files", response_model=MediaStorageOut)
def purge_clip_files(user_id: str, conn: sqlite3.Connection = Depends(get_db)) -> MediaStorageOut:
    """Free the disk without losing anything the learner saved.

    The extracted files go; the rows stay, demoted to 'virtual', which is the
    same state the timecodes-only storage policy produces. Every saved word
    keeps its line, its timecode and its ability to replay — the clip is just
    rebuilt from the source next time it is asked for. Deleting the rows
    instead would silently throw away the contexts.
    """
    rows = conn.execute(
        "SELECT c.id, c.clip_path, c.thumb_path FROM media_clips c "
        "JOIN media_items m ON m.id = c.media_item_id WHERE m.user_id = ? AND c.clip_path IS NOT NULL",
        (user_id,),
    ).fetchall()
    for row in rows:
        storage.delete_files(row["clip_path"], row["thumb_path"])
    conn.execute(
        "UPDATE media_clips SET status = 'virtual', clip_path = NULL, thumb_path = NULL, clip_bytes = 0 "
        "WHERE id IN (SELECT c.id FROM media_clips c JOIN media_items m ON m.id = c.media_item_id "
        "WHERE m.user_id = ? AND c.clip_path IS NOT NULL)",
        (user_id,),
    )
    conn.commit()
    return storage_summary(user_id, conn)


@file_router.get("/clips/{clip_id}/thumbnail")
def clip_thumbnail(clip_id: str, conn: sqlite3.Connection = Depends(get_db)) -> FileResponse:
    row = conn.execute("SELECT * FROM media_clips WHERE id = ?", (clip_id,)).fetchone()
    if row is None or not row["thumb_path"] or not Path(row["thumb_path"]).is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No thumbnail for this clip")
    return FileResponse(row["thumb_path"], media_type="image/jpeg")


# --------------------------------------------------------------------------
# player preferences (per learner, not per file)


@router.get("/prefs/player", response_model=PlayerPrefsOut)
def get_player_prefs(user_id: str, conn: sqlite3.Connection = Depends(get_db)) -> PlayerPrefsOut:
    row = _player_prefs_row(conn, user_id)
    values = {
        name: (bool(row[column]) if name in _BOOL_PREFS else row[column])
        for name, column in PLAYER_PREF_COLUMNS.items()
    }
    # The two that aren't a straight column read: 0001_init.sql stores these
    # as a '480p' string and a 'store'/'on_demand' enum, and the API speaks in
    # the numbers and booleans the client actually uses.
    values["clip_height"] = _clip_height(row)
    values["clip_store_files"] = _clip_store_files(row)
    return PlayerPrefsOut(**values)


@router.put("/prefs/player", response_model=PlayerPrefsOut)
def update_player_prefs(
    user_id: str, payload: PlayerPrefsUpdate, conn: sqlite3.Connection = Depends(get_db)
) -> PlayerPrefsOut:
    _player_prefs_row(conn, user_id)
    fields = payload.model_dump(exclude_unset=True)

    height = fields.pop("clip_height", None)
    store_files = fields.pop("clip_store_files", None)
    assignments = [f"{PLAYER_PREF_COLUMNS[name]} = ?" for name in fields]
    values: list[object] = [int(v) if name in _BOOL_PREFS else v for name, v in fields.items()]
    if height is not None:
        assignments.append("clip_resolution = ?")
        values.append(f"{int(height)}p")
    if store_files is not None:
        assignments.append("clip_storage_mode = ?")
        values.append("store" if store_files else "on_demand")

    if assignments:
        conn.execute(
            f"UPDATE user_settings SET {', '.join(assignments)} WHERE user_id = ?", (*values, user_id)
        )
    return get_player_prefs(user_id, conn)
