"""Where the local models run: the GPU when there is one, or the CPU.

One choice for the whole machine, kept in app_meta rather than per profile:
the GPU belongs to the computer, and engines are loaded once per process.

  auto — use a GPU when this machine has one the engine can use, else CPU
  gpu  — ask for the GPU; an engine that cannot use it falls back to the CPU
         and says why, rather than refusing to run
  cpu  — keep everything on the CPU, e.g. to leave the GPU to other work or
         when a driver misbehaves

Each engine reaches the GPU its own way, and not every engine can on every
machine — see `describe()` for what each one is actually doing.
"""

import sqlite3

MODES = ("auto", "gpu", "cpu")
DEFAULT_MODE = "auto"
_META_KEY = "local_compute"

# Read by the engines, which have no database connection of their own.
_mode = DEFAULT_MODE


def current() -> str:
    return _mode


def wants_gpu() -> bool:
    return _mode != "cpu"


def load(conn: sqlite3.Connection) -> str:
    """Called once at startup, so the engines see the saved choice."""
    global _mode
    row = conn.execute("SELECT value FROM app_meta WHERE key = ?", (_META_KEY,)).fetchone()
    value = row[0] if row else None
    _mode = value if value in MODES else DEFAULT_MODE
    return _mode


def save(conn: sqlite3.Connection, mode: str) -> None:
    global _mode
    if mode not in MODES:
        raise ValueError(f"mode must be one of {', '.join(MODES)}")
    conn.execute(
        "INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (_META_KEY, mode),
    )
    conn.commit()
    _mode = mode


# --- the ONNX Runtime voice (Kokoro) -----------------------------------------

# In order of preference. Which exist depends on the onnxruntime build that is
# installed: the standard macOS wheel has CoreML; Windows gains DirectML with
# onnxruntime-directml; NVIDIA machines gain CUDA with onnxruntime-gpu.
_ORT_GPU_PROVIDERS = (
    "CUDAExecutionProvider",
    "DmlExecutionProvider",
    "CoreMLExecutionProvider",
    "ROCMExecutionProvider",
    "MIGraphXExecutionProvider",
    "OpenVINOExecutionProvider",
)

ORT_PROVIDER_NAMES = {
    "CUDAExecutionProvider": "CUDA",
    "DmlExecutionProvider": "DirectML",
    "CoreMLExecutionProvider": "Core ML",
    "ROCMExecutionProvider": "ROCm",
    "MIGraphXExecutionProvider": "MIGraphX",
    "OpenVINOExecutionProvider": "OpenVINO",
    "CPUExecutionProvider": "CPU",
}


def ort_providers(available: list[str]) -> list[str]:
    """The providers to ask ONNX Runtime for, best first, CPU always last so
    anything the GPU provider cannot run still runs."""
    gpu = [p for p in _ORT_GPU_PROVIDERS if p in available] if wants_gpu() else []
    return [*gpu, "CPUExecutionProvider"]


# --- speech-to-text (faster-whisper / CTranslate2) ---------------------------


def whisper_device(cuda_devices: int) -> tuple[str, str]:
    """(device, compute_type). CTranslate2's only GPU backend is CUDA, so an
    integrated GPU cannot be used here — the model is small enough that the
    CPU handles it quickly anyway."""
    if wants_gpu() and cuda_devices > 0:
        return "cuda", "float16"
    return "cpu", "int8"
