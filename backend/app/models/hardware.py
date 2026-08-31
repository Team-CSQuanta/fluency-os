from pydantic import BaseModel


class HardwareAssessRequest(BaseModel):
    cpu_cores: int
    total_ram_bytes: int


class TierCapabilityOut(BaseModel):
    tier: str
    capable: bool
    min_ram_gb: float
    min_cores: int


class HardwareAssessmentOut(BaseModel):
    recommended_tier: str | None
    any_local_capable: bool
    tiers: list[TierCapabilityOut]
