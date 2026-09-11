import sqlite3

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.concurrency import run_in_threadpool

from app.db import get_db
from app.models.conversation import EngineStatusOut
from app.models.engine import (
    DownloadStatusOut,
    LlmOptionOut,
    ModelsCatalogOut,
    ReadinessOut,
    SelectLlmModelIn,
    SingleModelOut,
)
from app.security import require_token
from app.services import conversation
from app.services.voice import download_manager, engine_status, llm_chat_engine, model_catalog, model_manager, stt_engine, tts_engine
from app.services.voice.errors import EngineUnavailable

router = APIRouter(prefix="/engine", dependencies=[Depends(require_token)])


def _download_status_out(kind: str, key: str = "") -> DownloadStatusOut:
    return DownloadStatusOut(**download_manager.status(download_manager.download_key(kind, key)))


@router.get("/models", response_model=ModelsCatalogOut)
def list_models(user_id: str, conn: sqlite3.Connection = Depends(get_db)) -> ModelsCatalogOut:
    selected = conversation.selected_llm_option(conn, user_id)
    llm = [
        LlmOptionOut(
            key=o.key,
            label=o.label,
            note=o.note,
            approx_size_mb=o.approx_size_mb,
            downloaded=model_catalog.llm_is_downloaded(o),
            selected=o.key == selected.key,
            download=_download_status_out("llm", o.key),
        )
        for o in model_catalog.LLM_OPTIONS
    ]
    stt = SingleModelOut(
        label="faster-whisper tiny.en",
        downloaded=model_catalog.stt_is_downloaded(),
        download=_download_status_out("stt"),
    )
    tts = SingleModelOut(
        label="Kokoro af_heart",
        downloaded=model_catalog.tts_is_downloaded(),
        download=_download_status_out("tts"),
    )
    return ModelsCatalogOut(
        llm=llm,
        stt=stt,
        tts=tts,
        models_dir=str(model_manager.models_dir()),
        disk_usage_bytes=model_manager.disk_usage_bytes(),
    )


@router.post("/models/llm/{key}/download", response_model=DownloadStatusOut)
def download_llm(key: str) -> DownloadStatusOut:
    download_manager.start_download("llm", key)
    return _download_status_out("llm", key)


@router.post("/models/stt/download", response_model=DownloadStatusOut)
def download_stt() -> DownloadStatusOut:
    download_manager.start_download("stt", "")
    return _download_status_out("stt")


@router.post("/models/tts/download", response_model=DownloadStatusOut)
def download_tts() -> DownloadStatusOut:
    download_manager.start_download("tts", "")
    return _download_status_out("tts")


def _reject_if_downloading(kind: str, key: str = "") -> None:
    if download_manager.status(download_manager.download_key(kind, key))["status"] == "downloading":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Can't delete while it's downloading")


@router.delete("/models/llm/{key}", status_code=status.HTTP_204_NO_CONTENT)
def delete_llm(key: str) -> None:
    """Frees real disk space. If this happens to be the model currently
    loaded in memory, it's also unloaded — a deleted file has no business
    still reading as "launched"."""
    _reject_if_downloading("llm", key)
    option = model_catalog.llm_option(key)
    if not model_catalog.llm_delete(option):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="That model isn't downloaded")
    llm_chat_engine.unload(str(model_manager.llm_model_path(option.repo_id, option.filename)))


@router.delete("/models/stt", status_code=status.HTTP_204_NO_CONTENT)
def delete_stt() -> None:
    _reject_if_downloading("stt")
    if not model_catalog.stt_delete():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Speech-to-text isn't downloaded")
    stt_engine.unload()


@router.delete("/models/tts", status_code=status.HTTP_204_NO_CONTENT)
def delete_tts() -> None:
    _reject_if_downloading("tts")
    if not model_catalog.tts_delete():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Text-to-speech isn't downloaded")
    tts_engine.unload()


@router.post("/models/select", status_code=204)
def select_llm_model(payload: SelectLlmModelIn, conn: sqlite3.Connection = Depends(get_db)) -> None:
    conn.execute(
        """
        INSERT INTO user_settings (user_id, llm_model_id)
        VALUES (?, ?)
        ON CONFLICT(user_id) DO UPDATE SET llm_model_id = excluded.llm_model_id
        """,
        (payload.user_id, payload.model_key),
    )


@router.get("/readiness", response_model=ReadinessOut)
def readiness(user_id: str, channel: str = "voice", conn: sqlite3.Connection = Depends(get_db)) -> ReadinessOut:
    return ReadinessOut(**conversation.readiness(conn, user_id, channel))


@router.get("/status", response_model=EngineStatusOut)
def get_status(user_id: str, conn: sqlite3.Connection = Depends(get_db)) -> EngineStatusOut:
    """Whether each engine is actually loaded into memory right now — distinct
    from /readiness, which only reports what's downloaded to disk. Polled by
    the global "Launch AI" indicator while a launch is in progress.

    "llm" is specific to whichever model is *currently selected* for this
    user — switching to a different downloaded model in Settings correctly
    flips this back to not-ready until Launch AI is used again, rather than
    reading as still-ready off whatever was previously loaded."""
    option = conversation.selected_llm_option(conn, user_id)
    llm_path = str(model_manager.llm_model_path(option.repo_id, option.filename))
    return EngineStatusOut(**engine_status.status(llm_path))


@router.post("/launch", response_model=EngineStatusOut)
async def launch(user_id: str, conn: sqlite3.Connection = Depends(get_db)) -> EngineStatusOut:
    """Explicitly loads whatever's downloaded into memory — real, sometimes
    multi-minute work, so it's run off the event loop like conversation turn
    submission is."""
    try:
        result = await run_in_threadpool(conversation.launch_engines, conn, user_id)
    except EngineUnavailable as err:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(err)) from err
    return EngineStatusOut(**result)
