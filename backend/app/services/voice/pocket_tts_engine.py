"""Local text-to-speech via Pocket TTS (Kyutai). The alternative to
tts_engine.py's Kokoro, same lazy-singleton shape as the other engines, and
like them it never downloads implicitly — Settings/download_manager.py does.

Why it exists alongside Kokoro: Kokoro is non-streaming, so nothing is
audible until an entire chunk has been synthesized. That is the floor under
first-audio latency and the only reason conversation.py splits replies into
two chunks at all. Pocket TTS is autoregressive and yields audio while it is
still generating, so the first sound does not wait on the rest of the
sentence.

It is not a free win: it needs PyTorch and roughly half a gigabyte more
resident memory, and its lead narrows on CPUs without AVX-512/VNNI. Which
engine is better is therefore a per-machine question, which is why this is a
user-visible setting rather than a replacement.
"""

import io
import threading
import wave
from pathlib import Path

import numpy as np

from app.services.voice import model_manager, reply_chunking
from app.services.voice.errors import EngineUnavailable

VOICE = model_manager.POCKET_VOICE

# Pocket TTS resolves weights through a YAML config. Upstream's own configs
# point at hf:// URLs, which would re-download (from the gated repo) on every
# load; this is the same config with the three paths rewritten to the local
# files download_manager.py has already fetched. Copied from
# pocket_tts/config/english_2026-04.yaml — keep in step with that file if the
# pinned pocket-tts version changes.
_CONFIG_TEMPLATE = """\
weights_path: {weights}
default_temperature: 0.3

flow_lm:
  insert_bos_before_voice: true
  dtype: float32
  flow:
    depth: 6
    dim: 512
  transformer:
    d_model: 1024
    hidden_scale: 4
    max_period: 10000
    num_heads: 16
    num_layers: 6
  lookup_table:
    dim: 1024
    n_bins: 4000
    tokenizer: sentencepiece
    tokenizer_path: {tokenizer}

mimi:
  dtype: float32
  sample_rate: 24000
  inner_dim: 32
  outer_dim: 512
  channels: 1
  frame_rate: 12.5
  seanet:
    dimension: 512
    channels: 1
    n_filters: 64
    n_residual_layers: 1
    ratios:
    - 6
    - 5
    - 4
    kernel_size: 7
    residual_kernel_size: 3
    last_kernel_size: 3
    dilation_base: 2
    pad_mode: constant
    compress: 2
  transformer:
    d_model: 512
    num_heads: 8
    num_layers: 2
    layer_scale: 0.01
    context: 250
    dim_feedforward: 2048
    input_dimension: 512
    output_dimensions:
    - 512
  quantizer:
    dimension: 32
    output_dimension: 512
"""

_lock = threading.Lock()
_model = None
# Voice key -> its precomputed KV state. Loading one is a ~6MB file read, not
# inference, but every generation needs it, so the recent few are kept rather
# than re-read per sentence. Bounded because a learner auditioning voices in
# Settings would otherwise pin every one of them in memory.
_voice_states: dict[str, object] = {}
_MAX_VOICE_STATES = 3
_sample_rate = 24000


def _config_path(weights: Path, tokenizer: Path) -> Path:
    """Written next to the weights on first load rather than shipped, because
    it has to name absolute local paths that only exist on this machine."""
    path = weights.parent / "config.yaml"
    wanted = _CONFIG_TEMPLATE.format(weights=weights, tokenizer=tokenizer)
    if not path.exists() or path.read_text() != wanted:
        path.write_text(wanted)
    return path


def _load_locked():
    """Must only be called while holding `_lock` — see tts_engine for why."""
    global _model, _sample_rate
    if _model is not None:
        return _model
    # Files before imports: "not downloaded yet" is the state a learner
    # actually lands in and can act on, and checking it needs nothing loaded.
    # A missing package is a broken install, not a user error.
    weights, tokenizer, voice = model_manager.pocket_tts_paths()
    if not (weights.exists() and tokenizer.exists() and voice.exists()):
        raise EngineUnavailable("That voice hasn't been downloaded yet — download it in Settings first.")

    try:
        from pocket_tts import TTSModel
    except ImportError as err:
        raise EngineUnavailable(
            "pocket-tts isn't installed — reinstall the backend dependencies to use this voice."
        ) from err

    try:
        import torch

        model = TTSModel.load_model(config=_config_path(weights, tokenizer))
        # pocket_tts pins torch to a single thread at import time. This
        # machine class has four cores and nothing else runs during
        # synthesis — the LLM has already finished by the time we synthesize —
        # so capping at one core leaves most of the CPU idle. Two, not all
        # four: the upstream benchmarks are quoted at two, and leaving
        # headroom keeps the event loop responsive.
        torch.set_num_threads(min(2, torch.get_num_threads() or 2))
    except Exception as err:  # noqa: BLE001
        raise EngineUnavailable(f"Couldn't load Pocket TTS: {err}") from err

    _model, _sample_rate = model, model.sample_rate
    return _model


def _voice_state_locked(model, voice: str):
    """The state for one voice, loaded on first use. Also under `_lock`."""
    state = _voice_states.get(voice)
    if state is not None:
        return state
    path = model_manager.pocket_voice_path(voice)
    if not path.exists():
        raise EngineUnavailable("That voice hasn't been downloaded yet — pick it again in Settings.")
    try:
        state = model.get_state_for_audio_prompt(str(path))
    except Exception as err:  # noqa: BLE001
        raise EngineUnavailable(f"Couldn't load the voice '{voice}': {err}") from err
    while len(_voice_states) >= _MAX_VOICE_STATES:
        _voice_states.pop(next(iter(_voice_states)))
    _voice_states[voice] = state
    return state


def is_installed() -> bool:
    """Whether the pocket-tts package is importable. It ships behind an
    optional extra (it needs PyTorch), so unlike Kokoro this engine can be
    listed and downloadable on a machine that cannot actually run it — which
    Settings has to be able to say out loud rather than only discovering at
    the first attempt to speak."""
    from importlib.util import find_spec

    return find_spec("pocket_tts") is not None


def is_ready() -> bool:
    return _model is not None


def runtime_info() -> dict:
    """Always the CPU: Pocket TTS is built for it (parts of it are pinned to
    the CPU inside the package), and is quick enough there."""
    from app.services.voice import compute

    return {
        "device": "cpu" if _model is not None else None,
        "backend": "CPU" if _model is not None else None,
        "detail": None,
        "note": "This voice is designed to run on the CPU." if compute.wants_gpu() else None,
    }


def warm_up(voice: str | None = None) -> None:
    """Loads the model, and the voice too when told which one — otherwise
    that is left to the first sentence, since it is only a file read."""
    with _lock:
        model = _load_locked()
        if voice:
            _voice_state_locked(model, voice)


def unload() -> None:
    global _model
    with _lock:
        _model = None
        _voice_states.clear()


#: Seconds of synthesis per second of audio, measured on the reference
#: machine (Ryzen 3 3200G): 2.44s for a 4.64s reply, 0.78s for a 1.36s one.
SYNTH_RATIO = 0.55


def split_for_streaming(text: str) -> list[str]:
    """The same two-chunk rule as Kokoro, despite this engine streaming.

    Streaming would make splitting pointless if the audio reached the client
    as it was produced — the first frame lands in ~0.25s. It doesn't:
    ensure_audio_chunk writes a complete WAV and then serves the file, so the
    learner waits for the whole of chunk 0 either way. Measured on the
    reference machine, one chunk per reply cost 2.05s to first audio against
    1.09s when split — so "it streams" is not a reason to skip the split, it
    is a reason to stream end to end some day.

    Unlike Kokoro it runs faster than real time, so its pieces can grow
    (see reply_chunking) and play back to back."""
    return reply_chunking.split_for_streaming(text, synth_ratio=SYNTH_RATIO)


def synthesize(text: str, voice: str | None = None) -> bytes:
    """Returns WAV bytes for the given text, spoken in `voice` (a key from
    voices.POCKET_VOICES; the default when None)."""
    clean = text.strip()
    if not clean:
        raise EngineUnavailable("Nothing to synthesize")

    # Held across generation, unlike Kokoro's lock which covers loading only:
    # generate_audio_stream is documented as NOT thread-safe (it mutates the
    # model state and runs its own decoder thread), so two concurrent turns
    # would corrupt each other's audio rather than merely contend.
    with _lock:
        model = _load_locked()
        state = _voice_state_locked(model, voice or VOICE)
        try:
            chunks = [c for c in model.generate_audio_stream(state, clean, copy_state=True)]
        except Exception as err:  # noqa: BLE001
            raise EngineUnavailable(f"Pocket TTS synthesis failed: {err}") from err

    if not chunks:
        raise EngineUnavailable("Pocket TTS produced no audio")

    import torch

    samples = torch.cat([c.reshape(-1) for c in chunks]).numpy()
    pcm16 = (np.clip(samples, -1.0, 1.0) * 32767).astype(np.int16)
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(_sample_rate)
        wav_file.writeframes(pcm16.tobytes())
    return buffer.getvalue()
