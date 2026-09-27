from pydantic import BaseModel


class RecommendIn(BaseModel):
    cpu_cores: int
    total_ram_bytes: int
    #: The GPU's vendor as the desktop shell saw it ("amd", "nvidia", "intel",
    #: "apple"), or None when there is only a software renderer.
    gpu_vendor: str | None = None


class ModelFitOut(BaseModel):
    key: str
    label: str
    size_mb: int
    needs_gb: float
    #: "good" | "tight" | "too_big"
    fit: str
    #: "quick" | "steady" | "slow"
    speed: str
    note: str
    recommended: bool


class RecommendationOut(BaseModel):
    ram_gb: float
    cores: int
    gpu: str | None
    gpu_used: bool
    available_gb: float
    recommended: str
    reason: str
    cloud_suggested: bool
    models: list[ModelFitOut]
