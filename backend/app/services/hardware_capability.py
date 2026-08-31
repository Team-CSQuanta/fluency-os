"""Step 3 "Engine" model-tier recommendation.

This is a static heuristic over CPU core count and total RAM, NOT a measured
benchmark — there is no llama.cpp/faster-whisper/Kokoro integration in this
codebase yet, so real inference throughput cannot be observed. Thresholds
model the concurrent memory footprint of the LLM plus a live-conversation
pipeline (STT ~1GB for faster-whisper small.en, TTS ~0.5GB for Kokoro ONNX,
~1.5GB OS/Electron overhead) — see fluencyos_spec.md NFR-4 for the latency
budget this is protecting.

Balanced's floor (8GB RAM / 4 cores) is deliberately set to match spec
NFR-3's own stated reference machine ("<=3s on 4-core CPU, 8GB RAM"), the
most defensible anchor available. Light and Heavy's floors are this
module's own reasoned extrapolation, not spec-derived or benchmarked —
do not let that distinction erode over time.

Heavy is intentionally never auto-recommended even when its own thresholds
are met: the spec's own onboarding copy already admits CPU-only inference
at that size takes 6-9s per lookup, far past any conversational latency
budget. It stays selectable, just never the highlighted default.

GPU presence is deliberately NOT a signal here. A discrete GPU only helps if
the shipped llama.cpp build actually uses it (right drivers / CUDA-Metal-
Vulkan backend), which cannot be verified without the inference integration
this project doesn't have yet — recommending a bigger tier on the strength
of an unverifiable GPU would be an actively wrong recommendation, not just
an optimistic one.
"""

from dataclasses import dataclass

GIB = 1024**3

# (tier key, min RAM in bytes, min CPU cores) — ordered lightest to heaviest.
TIER_SPECS: tuple[tuple[str, int, int], ...] = (
    ("light", 6 * GIB, 2),
    ("balanced", 8 * GIB, 4),
    ("heavy", 12 * GIB, 6),
)

# Tiers ever eligible for the auto-highlighted "recommended" badge.
_AUTO_RECOMMENDABLE_TIERS = {"light", "balanced"}


@dataclass(frozen=True)
class TierCapability:
    tier: str
    capable: bool
    min_ram_gb: float
    min_cores: int


@dataclass(frozen=True)
class HardwareAssessment:
    recommended_tier: str | None
    any_local_capable: bool
    tiers: tuple[TierCapability, ...]


def assess_hardware(cpu_cores: int, total_ram_bytes: int) -> HardwareAssessment:
    # os.totalmem() reports usable RAM, which is routinely a few hundred MB
    # below the nominal stick size (reserved for firmware/integrated
    # graphics/etc) — e.g. a "6GB" machine can report ~5.7GB. Round to the
    # nearest whole GB before comparing so a machine the UI displays as
    # "6 GB RAM" isn't silently marked as failing a "needs >= 6GB" check.
    rounded_ram_gb = round(total_ram_bytes / GIB)

    tiers: list[TierCapability] = []
    recommended: str | None = None

    for tier, min_ram_bytes, min_cores in TIER_SPECS:
        capable = rounded_ram_gb >= (min_ram_bytes // GIB) and cpu_cores >= min_cores
        tiers.append(
            TierCapability(tier=tier, capable=capable, min_ram_gb=min_ram_bytes / GIB, min_cores=min_cores)
        )
        if capable and tier in _AUTO_RECOMMENDABLE_TIERS:
            recommended = tier

    any_local_capable = any(t.capable for t in tiers)

    return HardwareAssessment(
        recommended_tier=recommended,
        any_local_capable=any_local_capable,
        tiers=tuple(tiers),
    )
