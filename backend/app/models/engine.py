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


class TtsOptionOut(SingleModelOut):
    key: Literal["kokoro", "pocket"]
    note: str
    approx_size_mb: int
    selected: bool
    # Whether this engine's runtime is present at all. Pocket TTS lives behind
    # an optional extra, so it can be listed without being installable.
    installed: bool


class ModelsCatalogOut(BaseModel):
    llm: list[LlmOptionOut]
    stt: SingleModelOut
    # The engine the user has selected, kept for clients that only know about
    # one voice; `tts_options` is the full list.
    tts: SingleModelOut
    tts_options: list[TtsOptionOut]
    # Real, actual on-disk location and usage — not user-configurable, but
    # worth surfacing since nothing else in the app ever showed it.
    models_dir: str
    disk_usage_bytes: int


class SelectLlmModelIn(BaseModel):
    user_id: str
    model_key: str


class SelectTtsEngineIn(BaseModel):
    user_id: str
    engine: Literal["kokoro", "pocket"]


class VoiceOut(BaseModel):
    key: str
    name: str
    gender: Literal["female", "male"]
    accent: str | None
    note: str | None
    # Kokoro voices come with the engine; each Pocket voice is its own
    # small download.
    downloaded: bool
    approx_size_mb: float
    download: DownloadStatusOut


class VoicesOut(BaseModel):
    engine: Literal["kokoro", "pocket"]
    engine_label: str
    engine_downloaded: bool
    # What the learner picked, and what replies are spoken in right now. They
    # differ only while a newly picked voice is still downloading.
    chosen: str
    speaking: str
    voices: list[VoiceOut]


class SelectVoiceIn(BaseModel):
    user_id: str
    engine: Literal["kokoro", "pocket"]
    voice: str


class ReadinessOut(BaseModel):
    ready: bool
    llm: bool
    stt: bool
    tts: bool
    llm_model_label: str


class LlmProviderIn(BaseModel):
    user_id: str
    provider: Literal["local", "openrouter", "gemini"]
    # Only updates the stored value when given (so switching provider back
    # and forth doesn't require re-typing the key each time, and each cloud
    # provider's saved credentials survive switching to the other one); an
    # explicit empty string clears it.
    openrouter_api_key: str | None = None
    openrouter_model: str | None = None
    gemini_api_key: str | None = None
    gemini_model: str | None = None


class LlmProviderOut(BaseModel):
    provider: Literal["local", "openrouter", "gemini"]
    openrouter_model: str
    has_openrouter_key: bool
    # Last 4 characters only, e.g. "sk-…d2dd" — enough to recognize which
    # key is saved without ever re-exposing the real value to the renderer.
    openrouter_key_preview: str | None
    gemini_model: str
    has_gemini_key: bool
    gemini_key_preview: str | None


class EngineRuntimeOut(BaseModel):
    """Where one local engine is running right now."""

    #: "gpu" | "cpu", or None when it is not loaded.
    device: str | None
    #: "Vulkan", "Metal", "CUDA", "DirectML", "Core ML", "CPU"…
    backend: str | None
    #: The GPU's name, when known.
    detail: str | None
    #: Why it is on the CPU although the setting allows the GPU, if it is.
    note: str | None


class GpuRuntimeOut(BaseModel):
    #: Whether llama.cpp publishes a GPU build for this platform at all.
    available: bool
    installed: bool
    #: "Vulkan" | "Metal"
    backend: str
    #: GPUs the installed build can see; empty until it is installed.
    devices: list[str]
    download: DownloadStatusOut


class ComputeOut(BaseModel):
    #: "auto" | "gpu" | "cpu"
    mode: str
    chat_model: EngineRuntimeOut
    speech_to_text: EngineRuntimeOut
    voice: EngineRuntimeOut
    gpu_runtime: GpuRuntimeOut


class ComputeIn(BaseModel):
    mode: str
