import sqlite3

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.concurrency import run_in_threadpool

from app.db import get_db
from app.models.conversation import EngineStatusOut
from app.models.engine import (
    DownloadStatusOut,
    LlmOptionOut,
    LlmProviderIn,
    LlmProviderOut,
    ModelsCatalogOut,
    ReadinessOut,
    SelectLlmModelIn,
    SingleModelOut,
)
from app.security import require_token
from app.services import conversation
from app.services.voice import (
    cloud_llm_engine,
    download_manager,
    engine_health,
    gemini_llm_engine,
    llm_chat_engine,
    model_catalog,
    model_manager,
    stt_engine,
    tts_engine,
)
from app.services.voice.errors import EngineUnavailable

router = APIRouter(prefix="/engine", dependencies=[Depends(require_token)])


def _download_status_out(kind: str, key: str = "") -> DownloadStatusOut:
    return DownloadStatusOut(**download_manager.status(download_manager.download_key(kind, key)))


@router.get("/models", response_model=ModelsCatalogOut)
def list_models(user_id: str, conn: sqlite3.Connection = Depends(get_db)) -> ModelsCatalogOut:
    target = conversation.llm_target(conn, user_id)
    # No local option is "selected" while the cloud provider is active —
    # avoids the radio list showing a stale local pick that isn't what's
    # actually being used for generation right now.
    selected_key = target["option"].key if target["provider"] == "local" else None
    llm = [
        LlmOptionOut(
            key=o.key,
            label=o.label,
            note=o.note,
            approx_size_mb=o.approx_size_mb,
            downloaded=model_catalog.llm_is_downloaded(o),
            selected=o.key == selected_key,
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
    # Explicitly picking a local model also switches the provider back to
    # 'local' — otherwise choosing one while the cloud provider is active
    # would silently do nothing (Conversation would keep using OpenRouter).
    conn.execute(
        """
        INSERT INTO user_settings (user_id, llm_model_id, llm_mode)
        VALUES (?, ?, 'local')
        ON CONFLICT(user_id) DO UPDATE SET llm_model_id = excluded.llm_model_id, llm_mode = 'local'
        """,
        (payload.user_id, payload.model_key),
    )
    # Evict the outgoing model now rather than leaving it resident until the
    # next load: its RAM is exactly what the incoming one needs.
    option = model_catalog.llm_option(payload.model_key)
    selected_path = str(model_manager.llm_model_path(option.repo_id, option.filename))
    if llm_chat_engine.loaded_path() not in (None, selected_path):
        llm_chat_engine.unload()


def _key_preview(key: str | None) -> str | None:
    return f"…{key[-4:]}" if key and len(key) >= 4 else None


@router.get("/llm-provider", response_model=LlmProviderOut)
def get_llm_provider(user_id: str, conn: sqlite3.Connection = Depends(get_db)) -> LlmProviderOut:
    row = conn.execute(
        "SELECT llm_mode, api_provider, openrouter_api_key, openrouter_model, gemini_api_key, gemini_model "
        "FROM user_settings WHERE user_id = ?",
        (user_id,),
    ).fetchone()
    if row and row["llm_mode"] == "api":
        provider = "gemini" if row["api_provider"] == "gemini" else "openrouter"
    else:
        provider = "local"
    openrouter_key = row["openrouter_api_key"] if row else None
    gemini_key = row["gemini_api_key"] if row else None
    return LlmProviderOut(
        provider=provider,
        openrouter_model=(row["openrouter_model"] if row and row["openrouter_model"] else cloud_llm_engine.DEFAULT_MODEL),
        has_openrouter_key=bool(openrouter_key),
        openrouter_key_preview=_key_preview(openrouter_key),
        gemini_model=(row["gemini_model"] if row and row["gemini_model"] else gemini_llm_engine.DEFAULT_MODEL),
        has_gemini_key=bool(gemini_key),
        gemini_key_preview=_key_preview(gemini_key),
    )


@router.post("/llm-provider", status_code=status.HTTP_204_NO_CONTENT)
def set_llm_provider(payload: LlmProviderIn, conn: sqlite3.Connection = Depends(get_db)) -> None:
    llm_mode = "local" if payload.provider == "local" else "api"
    api_provider = None if payload.provider == "local" else payload.provider
    conn.execute(
        """
        INSERT INTO user_settings (user_id, llm_mode, api_provider)
        VALUES (?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET llm_mode = excluded.llm_mode, api_provider = excluded.api_provider
        """,
        (payload.user_id, llm_mode, api_provider),
    )
    if payload.openrouter_api_key is not None:
        conn.execute(
            "UPDATE user_settings SET openrouter_api_key = ? WHERE user_id = ?",
            (payload.openrouter_api_key.strip() or None, payload.user_id),
        )
    if payload.openrouter_model is not None:
        conn.execute(
            "UPDATE user_settings SET openrouter_model = ? WHERE user_id = ?",
            (payload.openrouter_model.strip() or None, payload.user_id),
        )
    if payload.gemini_api_key is not None:
        conn.execute(
            "UPDATE user_settings SET gemini_api_key = ? WHERE user_id = ?",
            (payload.gemini_api_key.strip() or None, payload.user_id),
        )
    if payload.gemini_model is not None:
        conn.execute(
            "UPDATE user_settings SET gemini_model = ? WHERE user_id = ?",
            (payload.gemini_model.strip() or None, payload.user_id),
        )
    # Whatever was proven about the previous credentials says nothing about
    # these, so the cloud engine has to earn "verified" again.
    engine_health.forget_all()
    # Moving to a cloud provider leaves the local model resident but unused —
    # a gigabyte-plus of RAM held for an engine nothing will call.
    if payload.provider != "local":
        llm_chat_engine.unload()


@router.get("/readiness", response_model=ReadinessOut)
def readiness(user_id: str, channel: str = "voice", conn: sqlite3.Connection = Depends(get_db)) -> ReadinessOut:
    return ReadinessOut(**conversation.readiness(conn, user_id, channel))


@router.get("/status", response_model=EngineStatusOut)
def get_status(user_id: str, conn: sqlite3.Connection = Depends(get_db)) -> EngineStatusOut:
    """Whether each engine is actually loaded into memory right now — distinct
    from /readiness, which only reports what's downloaded/configured. Polled
    by the global "Launch AI" indicator while a launch is in progress.

    "llm" is specific to whichever model/provider is *currently selected*
    for this user — switching to a different downloaded local model, or
    between local and cloud, correctly flips this back to not-ready until
    Launch AI is used again, rather than reading as still-ready off
    whatever was previously active."""
    return EngineStatusOut(**conversation.full_engine_status(conn, user_id))


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
