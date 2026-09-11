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
