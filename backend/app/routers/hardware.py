from dataclasses import asdict

from fastapi import APIRouter, Depends

from app.models.hardware import RecommendationOut, RecommendIn
from app.security import require_token
from app.services.hardware_capability import recommend
from app.services.voice import compute, llama_runtime

router = APIRouter(prefix="/engine", dependencies=[Depends(require_token)])


@router.post("/recommend", response_model=RecommendationOut)
def recommend_model(payload: RecommendIn) -> RecommendationOut:
    """Which of the app's local models suits this computer, and why."""
    result = recommend(
        payload.cpu_cores,
        payload.total_ram_bytes,
        payload.gpu_vendor,
        # A GPU only helps where llama.cpp publishes a GPU build for this
        # platform, and while the learner has not pinned the AI to the CPU.
        gpu_build_available=llama_runtime.gpu_asset() is not None and compute.wants_gpu(),
    )
    return RecommendationOut(**asdict(result))
