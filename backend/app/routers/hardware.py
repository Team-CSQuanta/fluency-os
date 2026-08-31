from fastapi import APIRouter, Depends

from app.models.hardware import HardwareAssessmentOut, HardwareAssessRequest, TierCapabilityOut
from app.security import require_token
from app.services.hardware_capability import assess_hardware

router = APIRouter(prefix="/engine", dependencies=[Depends(require_token)])


@router.post("/assess-hardware", response_model=HardwareAssessmentOut)
def assess(payload: HardwareAssessRequest) -> HardwareAssessmentOut:
    result = assess_hardware(payload.cpu_cores, payload.total_ram_bytes)
    return HardwareAssessmentOut(
        recommended_tier=result.recommended_tier,
        any_local_capable=result.any_local_capable,
        tiers=[
            TierCapabilityOut(tier=t.tier, capable=t.capable, min_ram_gb=t.min_ram_gb, min_cores=t.min_cores)
            for t in result.tiers
        ],
    )
