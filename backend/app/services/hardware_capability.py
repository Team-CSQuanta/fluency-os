"""Which local model to recommend during onboarding, for this computer.

It chooses from the models the app actually ships (model_catalog.LLM_OPTIONS)
and saves that model's own key, so what onboarding recommends is exactly what
Settings → AI then shows and what Launch AI loads. (It used to recommend
three abstract "tiers" — two of them models the app did not have — and saved
the tier name, which the app did not recognise, so every choice quietly
became the default model.)

Two questions, answered separately:

**Does it fit?** A model is never alone in memory. Alongside it run the
operating system and desktop, this app's window and its Python backend, and —
for spoken conversation — Pocket TTS and Whisper. So the model gets what is
left: total RAM minus BASELINE_GB and VOICE_GB. A model needs its file size
plus roughly a tenth for runtime buffers and 0.4 GB for the context (KV
cache); that puts Gemma 4 E2B at ~3.7 GB and E4B at ~5.6 GB, in line with
the catalog's own "needs ~3 GB / ~5 GB of free RAM" notes. Within 80% of
what is left fits well; up to all of it is tight — it runs, but other apps
will push it into swap; beyond that it will not fit.

**Is it quick enough to talk to?** Generating text on a CPU is limited by
memory bandwidth, so time per word grows with model size and shrinks with
cores up to about eight. A GPU that llama.cpp can drive (a Vulkan or Metal
build exists for this platform, and a GPU was detected) speeds that up; it is
counted as a 1.5× gain — a deliberately modest figure, since an integrated GPU
shares the same memory. These are speed *classes* (quick / steady / slow),
not promised seconds: nothing is benchmarked before a model is downloaded.

The recommendation is the most capable model that fits well and is not slow.
Failing that, the most capable one that is tight but not slow; failing that,
the smallest model, with a note that a cloud model would serve better.
"""

from dataclasses import dataclass

from app.services.voice import model_catalog

GIB = 1024**3

#: OS + desktop, the app's window, and the Python backend — resident whatever
#: the model is.
BASELINE_GB = 2.0
#: Pocket TTS (~0.6 GB resident) and Whisper tiny.en int8 (~0.2 GB), which a
#: spoken conversation keeps loaded next to the model.
VOICE_GB = 0.8
#: Runtime buffers as a share of the model file, and the context (KV cache).
_RUNTIME_SHARE = 0.1
_CONTEXT_GB = 0.4
#: The share of the remaining memory a model can take and still "fit well".
_COMFORT = 0.8
#: Speed-class boundaries, in GB of model per unit of core factor.
_QUICK = 1.2
_STEADY = 2.2
_GPU_SPEEDUP = 1.5

#: Least to most capable. Gemma 3 1B sits below Qwen2.5 1.5B; Gemma 4 E2B
#: above Qwen2.5 3B.
QUALITY_ORDER = ("qwen2.5-0.5b", "gemma-3-1b", "qwen2.5-1.5b", "qwen2.5-3b", "gemma-4-e2b", "gemma-4-e4b")

_GPU_VENDORS = {"nvidia": "NVIDIA", "amd": "AMD", "intel": "Intel", "apple": "Apple"}


@dataclass(frozen=True)
class ModelFit:
    key: str
    label: str
    size_mb: int
    needs_gb: float
    fit: str  # "good" | "tight" | "too_big"
    speed: str  # "quick" | "steady" | "slow"
    note: str
    recommended: bool


@dataclass(frozen=True)
class Recommendation:
    ram_gb: float
    cores: int
    gpu: str | None
    gpu_used: bool
    available_gb: float
    recommended: str
    reason: str
    cloud_suggested: bool
    models: tuple[ModelFit, ...]


def needs_gb(size_mb: int) -> float:
    size_gb = size_mb / 1024
    return round(size_gb * (1 + _RUNTIME_SHARE) + _CONTEXT_GB, 1)


def _speed(size_mb: int, cores: int, gpu_used: bool) -> str:
    core_factor = max(min(cores, 8), 1) / 4
    load = (size_mb / 1024) / core_factor / (_GPU_SPEEDUP if gpu_used else 1)
    return "quick" if load <= _QUICK else "steady" if load <= _STEADY else "slow"


def gpu_name(vendor: str | None) -> str | None:
    """A vendor the GPU build can use; software renderers and unknowns are
    not a GPU for this purpose."""
    return _GPU_VENDORS.get((vendor or "").strip().lower())


def recommend(
    cpu_cores: int, total_ram_bytes: int, gpu_vendor: str | None = None, *, gpu_build_available: bool = True
) -> Recommendation:
    ram_gb = total_ram_bytes / GIB
    cores = max(cpu_cores, 1)
    gpu = gpu_name(gpu_vendor)
    gpu_used = gpu is not None and gpu_build_available
    available = max(ram_gb - BASELINE_GB - VOICE_GB, 0.0)

    rated: list[tuple[model_catalog.LlmOption, float, str, str]] = []
    for option in model_catalog.LLM_OPTIONS:
        need = needs_gb(option.approx_size_mb)
        fit = "good" if need <= available * _COMFORT else "tight" if need <= available else "too_big"
        rated.append((option, need, fit, _speed(option.approx_size_mb, cores, gpu_used)))

    def best(fits: set[str]):
        usable = [r for r in rated if r[2] in fits and r[3] != "slow"]
        return max(usable, key=lambda r: QUALITY_ORDER.index(r[0].key), default=None)

    choice = best({"good"}) or best({"good", "tight"})
    cloud = choice is None or choice[2] == "tight" and QUALITY_ORDER.index(choice[0].key) <= 1
    if choice is None:
        choice = min(rated, key=lambda r: r[0].approx_size_mb)

    option, need, fit, speed = choice
    ram_text = f"{round(ram_gb)} GB"
    where = f"{cores} cores" + (f" with your {gpu} GPU" if gpu_used else "")
    slower_bigger = any(
        f in ("good", "tight") and s == "slow" and QUALITY_ORDER.index(o.key) > QUALITY_ORDER.index(option.key)
        for o, _, f, s in rated
    )
    if fit == "good":
        reason = (
            f"Fits comfortably in {ram_text} next to the voice models, "
            f"and replies {'quickly' if speed == 'quick' else 'at a steady pace'} on {where}."
            + (" Bigger models fit too, but would reply slowly here." if slower_bigger else "")
        )
    elif fit == "tight":
        reason = (
            f"Fits in {ram_text}, but only just — close other large apps while you practise. "
            "Nothing bigger would fit."
            + (" A cloud model would be faster and smarter on this computer." if cloud else "")
        )
    else:
        reason = (
            f"Even the smallest model is a squeeze in {ram_text} once the voice models are loaded. "
            "A cloud model would be faster and smarter on this computer."
        )

    models = tuple(
        ModelFit(
            key=o.key,
            label=o.label,
            size_mb=o.approx_size_mb,
            needs_gb=n,
            fit=f,
            speed=s,
            note=o.note,
            recommended=o.key == option.key,
        )
        for o, n, f, s in sorted(rated, key=lambda r: QUALITY_ORDER.index(r[0].key))
    )
    return Recommendation(
        ram_gb=round(ram_gb, 1),
        cores=cores,
        gpu=gpu,
        gpu_used=gpu_used,
        available_gb=round(available, 1),
        recommended=option.key,
        reason=reason,
        cloud_suggested=cloud,
        models=models,
    )
