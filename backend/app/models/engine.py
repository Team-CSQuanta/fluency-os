from typing import Literal

from pydantic import BaseModel


class DownloadStatusOut(BaseModel):
    status: str  # idle | downloading | ready | error
    downloaded_bytes: int
    total_bytes: int
    error: str | None


class LlmOptionOut(BaseModel):
    key: str
    label: str
    note: str
    approx_size_mb: int
    downloaded: bool
    selected: bool
    download: DownloadStatusOut


class SingleModelOut(BaseModel):
    label: str
    downloaded: bool
    download: DownloadStatusOut


class ModelsCatalogOut(BaseModel):
    llm: list[LlmOptionOut]
    stt: SingleModelOut
    tts: SingleModelOut
    # Real, actual on-disk location and usage — not user-configurable, but
    # worth surfacing since nothing else in the app ever showed it.
    models_dir: str
    disk_usage_bytes: int


class SelectLlmModelIn(BaseModel):
    user_id: str
    model_key: str


class ReadinessOut(BaseModel):
    ready: bool
    llm: bool
    stt: bool
    tts: bool
    llm_model_label: str


class LlmProviderIn(BaseModel):
    user_id: str
    provider: Literal["local", "cloud"]
    # Only updates the stored value when given (so switching provider back
    # and forth doesn't require re-typing the key each time); an explicit
    # empty string clears it.
    openrouter_api_key: str | None = None
    openrouter_model: str | None = None


class LlmProviderOut(BaseModel):
    provider: Literal["local", "cloud"]
    openrouter_model: str
    has_api_key: bool
    # Last 4 characters only, e.g. "sk-…d2dd" — enough to recognize which
    # key is saved without ever re-exposing the real value to the renderer.
    api_key_preview: str | None
