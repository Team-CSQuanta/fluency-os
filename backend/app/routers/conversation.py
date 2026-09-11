import json
import sqlite3
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse

from app.db import get_db
from app.models.conversation import (
    ConversationReportOut,
    ConversationSessionCreate,
    ConversationSessionDetailOut,
    ConversationSessionOut,
    ConversationTurnOut,
    EngineStatusOut,
    TargetWordOut,
    TurnSubmitOut,
)
from app.security import require_token
from app.services import conversation
from app.services.voice import engine_status
from app.services.voice.errors import EngineUnavailable

router = APIRouter(prefix="/conversation", dependencies=[Depends(require_token)])


def _turn_out(row: sqlite3.Row) -> ConversationTurnOut:
    return ConversationTurnOut(
        id=row["id"],
        turn_index=row["turn_index"],
        speaker=row["speaker"],
        text=row["text"],
        audio_url=f"/conversation/turns/{row['id']}/audio" if row["audio_path"] else None,
        stt_confidence=row["stt_confidence"],
        created_at=row["created_at"],
    )


def _target_words_out(conn: sqlite3.Connection, session: sqlite3.Row) -> list[TargetWordOut]:
    word_ids = json.loads(session["target_word_ids"])
    if not word_ids:
        return []
    rows = conn.execute(
        f"SELECT id, word FROM vocab_words WHERE id IN ({','.join('?' for _ in word_ids)})", word_ids
    ).fetchall()

    outcomes: dict[str, str] = {}
    if session["report_json"]:
        report = json.loads(session["report_json"])
        outcomes = {r["word"]: r["outcome"] for r in report.get("routing", [])}

    return [TargetWordOut(id=r["id"], word=r["word"], used_outcome=outcomes.get(r["word"])) for r in rows]


def _session_out(conn: sqlite3.Connection, row: sqlite3.Row) -> ConversationSessionOut:
    return ConversationSessionOut(
        id=row["id"],
        user_id=row["user_id"],
        scenario=row["scenario"],
        channel=row["channel"],
        target_words=_target_words_out(conn, row),
        started_at=row["started_at"],
        ended_at=row["ended_at"],
        has_report=row["report_json"] is not None,
    )


def _get_owned_session(conn: sqlite3.Connection, session_id: str, user_id: str) -> sqlite3.Row:
    row = conversation.get_session_row(conn, session_id, user_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation session not found")
    return row


@router.get("/engine-status", response_model=EngineStatusOut)
def get_engine_status(user_id: str, conn: sqlite3.Connection = Depends(get_db)) -> EngineStatusOut:
    # "llm" is pinned to whichever model this user currently has selected —
    # see engine_status.status()'s docstring for why that matters.
    option = conversation.selected_llm_option(conn, user_id)
    llm_path = str(conversation.model_manager.llm_model_path(option.repo_id, option.filename))
    return EngineStatusOut(**engine_status.status(llm_path))


@router.get("/sessions", response_model=list[ConversationSessionOut])
def list_sessions(user_id: str, conn: sqlite3.Connection = Depends(get_db)) -> list[ConversationSessionOut]:
    return [_session_out(conn, row) for row in conversation.list_sessions(conn, user_id)]


@router.post("/sessions", response_model=ConversationSessionOut)
def start_session(
    payload: ConversationSessionCreate, conn: sqlite3.Connection = Depends(get_db)
) -> ConversationSessionOut:
    try:
        session_id = conversation.start_session(
            conn, user_id=payload.user_id, scenario=payload.scenario, channel=payload.channel
        )
    except EngineUnavailable as err:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(err)) from err
    row = conversation.get_session_row(conn, session_id, payload.user_id)
    return _session_out(conn, row)


@router.get("/sessions/{session_id}", response_model=ConversationSessionDetailOut)
def get_session_detail(
    session_id: str, user_id: str, conn: sqlite3.Connection = Depends(get_db)
) -> ConversationSessionDetailOut:
    row = _get_owned_session(conn, session_id, user_id)
    base = _session_out(conn, row)
    return ConversationSessionDetailOut(
        **base.model_dump(), turns=[_turn_out(t) for t in conversation.get_turns(conn, session_id)]
    )


@router.post("/sessions/{session_id}/turns", response_model=TurnSubmitOut)
async def submit_turn(
    session_id: str,
    user_id: str,
    text: str | None = Form(default=None),
    audio: UploadFile | None = File(default=None),
    conn: sqlite3.Connection = Depends(get_db),
) -> TurnSubmitOut:
    session = _get_owned_session(conn, session_id, user_id)
    # A session with a report already isn't "closed" — ending just produces a
    # checkpoint report; the learner can keep talking afterward and re-end
    # later for an updated one (see end_session below).

    audio_bytes = await audio.read() if audio is not None else None
    if not text and not audio_bytes:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Provide text or audio")

    try:
        # This does real, slow, CPU-bound work (STT + LLM generation, maybe
        # TTS) — run it off the event loop so it doesn't block every other
        # concurrent request (e.g. engine-status polling) for the whole
        # duration, which otherwise looks like a dropped connection ("Failed
        # to fetch") to the frontend.
        user_turn, ai_turn = await run_in_threadpool(
            conversation.submit_user_turn, conn, session, text=text, audio_bytes=audio_bytes
        )
    except EngineUnavailable as err:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(err)) from err

    return TurnSubmitOut(user_turn=_turn_out(user_turn), ai_turn=_turn_out(ai_turn))


@router.post("/sessions/{session_id}/end", response_model=ConversationReportOut)
def end_session(session_id: str, user_id: str, conn: sqlite3.Connection = Depends(get_db)) -> ConversationReportOut:
    """Always recomputes — a session can be ended, continued, and ended again,
    each time producing a fresh checkpoint report over the full transcript
    so far (and logging another real usage event per target word, same as
    any other checkpoint)."""
    session = _get_owned_session(conn, session_id, user_id)
    try:
        report = conversation.end_session(conn, session)
    except EngineUnavailable as err:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(err)) from err
    return ConversationReportOut(**report)


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_session(session_id: str, user_id: str, conn: sqlite3.Connection = Depends(get_db)) -> None:
    if not conversation.delete_session(conn, user_id, session_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation session not found")


@router.get("/sessions/{session_id}/report", response_model=ConversationReportOut)
def get_report(session_id: str, user_id: str, conn: sqlite3.Connection = Depends(get_db)) -> ConversationReportOut:
    session = _get_owned_session(conn, session_id, user_id)
    if session["report_json"] is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session hasn't ended yet")
    return ConversationReportOut(**json.loads(session["report_json"]))


@router.get("/turns/{turn_id}/audio")
def get_turn_audio(turn_id: str, user_id: str, conn: sqlite3.Connection = Depends(get_db)) -> FileResponse:
    row = conn.execute(
        """
        SELECT ct.audio_path FROM conversation_turns ct
        JOIN conversation_sessions cs ON cs.id = ct.session_id
        WHERE ct.id = ? AND cs.user_id = ?
        """,
        (turn_id, user_id),
    ).fetchone()
    if row is None or not row["audio_path"] or not Path(row["audio_path"]).exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No audio for this turn")
    return FileResponse(row["audio_path"], media_type="audio/wav")
