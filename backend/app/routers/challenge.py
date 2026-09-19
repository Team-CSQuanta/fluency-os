"""Scene Description Challenge (spec §6.4).

Needs both local engines: speech-to-text to hear the attempt, and the LLM to
judge it. Both are checked up front and refused with something actionable
rather than failing somewhere inside the scoring.
"""

import json
import sqlite3

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status

from app.db import get_db
from app.models.challenge import (
    EnrichmentOut,
    ChallengeRoundOut,
    ChallengeStartIn,
    ChallengeStatsOut,
    EmbedPrefIn,
    HintsOut,
)
from app.security import require_token
from app.services import challenge, vatex_scenes
from app.services.voice import stt_engine
from app.services.voice.errors import EngineUnavailable

router = APIRouter(prefix="/challenge", dependencies=[Depends(require_token)])


def _round_out(row: sqlite3.Row) -> ChallengeRoundOut:
    scored = row["status"] == "scored"
    targets = json.loads(row["target_words"] or "[]")
    references = json.loads(row["reference_captions"] or "[]")
    return ChallengeRoundOut(
        id=row["id"],
        kind=row["kind"],
        source=row["source"],
        video_id=row["video_id"],
        start_s=row["start_s"],
        end_s=row["end_s"],
        embed_url=(
            vatex_scenes.embed_url(row["video_id"], row["start_s"] or 0, row["end_s"] or 0)
            if row["video_id"]
            else None
        ),
        prompt=row["prompt"],
        media_item_id=row["media_item_id"],
        clip_id=row["clip_id"],
        media_title=row["media_title"],
        start_ms=row["start_ms"],
        end_ms=row["end_ms"],
        status=row["status"],
        target_word_count=len(targets),
        started_at=row["started_at"],
        transcript=row["transcript"],
        speech_seconds=row["speech_seconds"],
        target_coverage=row["target_coverage"],
        duration_score=row["duration_score"],
        grammar_score=row["grammar_score"],
        relevance_score=row["relevance_score"],
        detail_score=row["detail_score"],
        content_recall=row["content_recall"],
        raw_overall=row["raw_overall"],
        hint_level=row["hint_level"] or 0,
        hint_penalty=row["hint_penalty"] or 0,
        overall=row["overall"],
        feedback=json.loads(row["feedback"]) if row["feedback"] else None,
        # Only after the attempt: these are the answer.
        cue_text=row["cue_text"] if scored else None,
        target_words=targets if scored else [],
        reference_captions=references if scored else [],
    )


def _require_round(conn: sqlite3.Connection, round_id: str) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM challenge_rounds WHERE id = ?", (round_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Challenge round not found")
    return row


def _stt_downloaded() -> bool:
    from app.services.voice import model_manager

    cache = model_manager.whisper_cache_dir()
    return any(cache.glob(f"models--Systran--faster-whisper-{stt_engine.MODEL_SIZE}/**/model.bin"))


@router.get("/stats", response_model=ChallengeStatsOut)
def get_stats(user_id: str, conn: sqlite3.Connection = Depends(get_db)) -> ChallengeStatsOut:
    played = conn.execute(
        "SELECT COUNT(*) AS n FROM challenge_rounds WHERE user_id = ? AND status = 'scored'",
        (user_id,),
    ).fetchone()["n"]
    return ChallengeStatsOut(
        personal_bests=challenge.personal_bests(conn, user_id),
        rounds_played=played,
        stt_ready=_stt_downloaded(),
        scenes_available=vatex_scenes.size(conn),
        embeds_enabled=_embeds_enabled(conn, user_id),
        scene_pool=vatex_scenes.cooldown_state(conn, user_id),
    )


@router.post("/rounds", response_model=ChallengeRoundOut, status_code=status.HTTP_201_CREATED)
def start_round(payload: ChallengeStartIn, conn: sqlite3.Connection = Depends(get_db)) -> ChallengeRoundOut:
    if not _embeds_enabled(conn, payload.user_id):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Scenes from VATEX play as YouTube embeds, which is the one thing in FluencyOS "
            "that contacts the internet. Turn it on in Settings to use them.",
        )
    try:
        row = challenge.start_round(conn, user_id=payload.user_id)
    except ValueError as err:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(err)) from err
    if row is None:
        state = vatex_scenes.cooldown_state(conn, payload.user_id)
        detail = (
            f"Every scene you have not already seen is resting. "
            f"{state.get('resting', 0)} are within their {state.get('cooldown_days', 60)}-day "
            f"cooldown and {state.get('unavailable', 0)} have been withdrawn as unplayable. "
            "Come back tomorrow."
        )
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail)
    return _round_out(row)


def _embeds_enabled(conn: sqlite3.Connection, user_id: str) -> bool:
    row = conn.execute(
        "SELECT scene_embeds_enabled FROM user_settings WHERE user_id = ?", (user_id,)
    ).fetchone()
    return bool(row["scene_embeds_enabled"]) if row else False


@router.put("/prefs/embeds", response_model=ChallengeStatsOut)
def set_embeds(payload: EmbedPrefIn, conn: sqlite3.Connection = Depends(get_db)) -> ChallengeStatsOut:
    """Turn YouTube-embedded scenes on or off.

    Its own endpoint rather than a field on the onboarding settings payload:
    this is the single switch that decides whether the app talks to anyone
    else, and it should be findable and auditable on its own.
    """
    conn.execute(
        "INSERT INTO user_settings (user_id, scene_embeds_enabled) VALUES (?, ?) "
        "ON CONFLICT(user_id) DO UPDATE SET scene_embeds_enabled = excluded.scene_embeds_enabled",
        (payload.user_id, int(payload.enabled)),
    )
    conn.commit()
    return get_stats(payload.user_id, conn)


@router.post("/rounds/{round_id}/unavailable", response_model=ChallengeRoundOut)
def report_unavailable(round_id: str, conn: sqlite3.Connection = Depends(get_db)) -> ChallengeRoundOut:
    """The clip would not play. These are decade-old YouTube links and a fair
    share have been deleted or made private since VATEX was collected; the id
    is recorded globally so nobody is served it again."""
    row = _require_round(conn, round_id)
    if row["video_id"]:
        vatex_scenes.mark_unavailable(conn, row["video_id"])
    conn.execute("UPDATE challenge_rounds SET status = 'abandoned' WHERE id = ?", (row["id"],))
    return _round_out(_require_round(conn, round_id))


@router.post("/rounds/{round_id}/playback-error", response_model=ChallengeRoundOut)
def report_playback_error(
    round_id: str, reason: str = "", conn: sqlite3.Connection = Depends(get_db)
) -> ChallengeRoundOut:
    """The player itself said the video will not play.

    Distinct from /unavailable, which is the learner pressing a button after
    sitting in front of a dead embed. The YouTube iframe reports an error code
    within a second of loading, so the page forwards it here and takes the next
    scene automatically. Roughly one VATEX video in five has been deleted or
    made private since the corpus was collected, which is a lot of rounds to
    ask a learner to diagnose by hand.
    """
    row = _require_round(conn, round_id)
    if row["video_id"]:
        vatex_scenes.mark_playback_error(conn, row["video_id"], reason)
    conn.execute("UPDATE challenge_rounds SET status = 'abandoned' WHERE id = ?", (row["id"],))
    return _round_out(_require_round(conn, round_id))


@router.get("/rounds/{round_id}", response_model=ChallengeRoundOut)
def get_round(round_id: str, conn: sqlite3.Connection = Depends(get_db)) -> ChallengeRoundOut:
    return _round_out(_require_round(conn, round_id))


@router.get("/rounds/{round_id}/hints", response_model=HintsOut)
def get_hints(
    round_id: str, level: int | None = None, conn: sqlite3.Connection = Depends(get_db)
) -> HintsOut:
    """Ask for help. `level` is which tier of a VATEX round to unlock; omitted,
    it advances by one. Library rounds ignore it — their hints are the
    learner's own target words and there is nothing to grade."""
    return HintsOut(**challenge.hints_for(conn, _require_round(conn, round_id), level=level))


@router.post("/rounds/{round_id}/abandon", response_model=ChallengeRoundOut)
def abandon_round(round_id: str, conn: sqlite3.Connection = Depends(get_db)) -> ChallengeRoundOut:
    row = _require_round(conn, round_id)
    conn.execute("UPDATE challenge_rounds SET status = 'abandoned' WHERE id = ?", (row["id"],))
    return _round_out(_require_round(conn, round_id))


@router.post("/rounds/{round_id}/submit", response_model=ChallengeRoundOut)
async def submit_round(
    round_id: str,
    user_id: str = Form(...),
    audio: UploadFile | None = File(default=None),
    text: str | None = Form(default=None),
    conn: sqlite3.Connection = Depends(get_db),
) -> ChallengeRoundOut:
    """Score an attempt, from a recording or from typed text.

    Typed attempts are allowed on purpose: the speaking-duration part of the
    score is then zero and says so, but a learner without a working microphone
    should not be locked out of the rest of the feature.
    """
    row = _require_round(conn, round_id)
    if row["status"] == "scored":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This round is already scored.")

    transcript = (text or "").strip()
    speech_seconds = 0.0
    confidence = 0.0

    if audio is not None:
        if not _stt_downloaded():
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="The speech-to-text model isn't downloaded yet — get it in Settings first.",
            )
        try:
            transcript, confidence, speech_seconds = stt_engine.transcribe(await audio.read())
        except ValueError as err:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(err)) from err
        except EngineUnavailable as err:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(err)) from err

    if not transcript:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Nothing was recognised — try again, a little closer to the microphone.",
        )

    try:
        judged = challenge.judge(conn, user_id=user_id, row=row, transcript=transcript)
    except EngineUnavailable as err:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(err)) from err

    scored = challenge.apply_score(
        conn,
        row=row,
        transcript=transcript,
        speech_seconds=speech_seconds,
        stt_confidence=confidence,
        judged=judged,
    )
    return _round_out(scored)


@router.post("/rounds/{round_id}/enrich", response_model=EnrichmentOut)
async def enrich_round(
    round_id: str, user_id: str, conn: sqlite3.Connection = Depends(get_db)
) -> EnrichmentOut:
    """A richer description of the scene, built from the ten, using the
    learner's own vocabulary where it genuinely fits.

    A POST rather than part of the scored round: it spends a real model call.
    Offered only after scoring — handing it over first would hand over the
    answer, which is what the ten descriptions are.
    """
    row = _require_round(conn, round_id)
    if row["status"] != "scored":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Describe the scene first — this is the model's version to compare against.",
        )
    try:
        result = await run_in_threadpool(challenge.enrich, conn, user_id=user_id, row=row)
    except EngineUnavailable as err:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(err)) from err
    except ValueError as err:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(err)) from err
    return EnrichmentOut(**result)


@router.get("/history", response_model=list[ChallengeRoundOut])
def get_history(user_id: str, conn: sqlite3.Connection = Depends(get_db)) -> list[ChallengeRoundOut]:
    return [_round_out(r) for r in challenge.history(conn, user_id)]
