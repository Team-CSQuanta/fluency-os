"""Local speech-to-text via faster-whisper. Model size is pinned to
tiny.en — the smallest real option — given this app's stated hardware
tier (see hardware_capability.py). faster-whisper *can* auto-download it
from Hugging Face on construction, but that's exactly the implicit-download
behavior this app moved away from (see download_manager.py) — so this
module checks the cache itself first and refuses to construct the model
(and therefore trigger a download) until Settings has fetched it.
"""

import io
import threading
from pathlib import Path

from app.services.voice import model_manager
from app.services.voice.errors import EngineUnavailable

MODEL_SIZE = "tiny.en"
_SAMPLE_RATE = 16000

# A clip this quiet never contains speech — it's what a muted mic or an input
# device that isn't actually capturing produces. Worth telling apart from a
# real recording nothing could be made out of, because the fix is completely
# different (check your mic vs. speak more clearly).
_SILENCE_PEAK = 0.01
# Chromium emits a valid WebM with container headers but essentially no audio
# if the mic is stopped right after starting, so byte count alone can't catch
# an accidental double-tap.
_MIN_SECONDS = 0.4

_lock = threading.Lock()
_model = None


def _load_model_locked():
    """Must only be called while holding `_lock` — see the matching note in
    llm_chat_engine._load_llm_locked for why the whole load-and-transcribe
    operation, not just loading, needs to be serialized."""
    global _model
    if _model is not None:
        return _model
    try:
        from faster_whisper import WhisperModel
    except ImportError as err:
        raise EngineUnavailable("faster-whisper isn't installed") from err
    cache = model_manager.whisper_cache_dir()
    if not any(cache.glob(f"models--Systran--faster-whisper-{MODEL_SIZE}/**/model.bin")):
        raise EngineUnavailable("The local STT model isn't downloaded yet — download it in Settings first.")
    try:
        _model = WhisperModel(
            MODEL_SIZE,
            device="cpu",
            compute_type="int8",
            download_root=str(model_manager.whisper_cache_dir()),
        )
    except Exception as err:  # noqa: BLE001
        raise EngineUnavailable(f"Couldn't load the local STT model: {err}") from err
    return _model


def is_ready() -> bool:
    return _model is not None


def warm_up() -> None:
    """See llm_chat_engine.warm_up — same explicit-load-ahead-of-use idea."""
    with _lock:
        _load_model_locked()


def unload() -> None:
    """See llm_chat_engine.unload — called when the model is deleted from
    disk via Settings. Only one STT option exists, so any delete means
    unconditionally unload."""
    global _model
    with _lock:
        _model = None


def transcribe(audio_bytes: bytes) -> tuple[str, float, float]:
    """Returns (text, confidence, speech_seconds).

    `confidence` is a 0-1 proxy derived from the average log-probability
    faster-whisper reports per segment — a real signal, not a fabricated
    score, but explicitly a proxy for true word-level confidence (matches the
    report's existing `stt_proxy` naming).

    `speech_seconds` is the summed span of the recognised segments, not the
    length of the clip: recording runs continuously in hands-free mode, so the
    raw clip carries silence on both sides that would drag a words-per-minute
    figure down for no reason the learner could act on.

    Raises ValueError (a bad recording, surfaced as a 400) when the clip is
    too short or silent, so those two cases get their own actionable message
    instead of the caller's generic "nothing was recognised".
    """
    from faster_whisper.audio import decode_audio

    with _lock:
        model = _load_model_locked()
        try:
            audio = decode_audio(io.BytesIO(audio_bytes), sampling_rate=_SAMPLE_RATE)
        except Exception as err:  # noqa: BLE001
            raise EngineUnavailable(f"Couldn't read that recording: {err}") from err

        seconds = len(audio) / _SAMPLE_RATE
        peak = float(max(abs(audio.min(initial=0.0)), abs(audio.max(initial=0.0)))) if len(audio) else 0.0
        if seconds < _MIN_SECONDS:
            raise ValueError(
                f"That recording was only {seconds:.1f}s long — tap the mic, speak, then tap again to stop."
            )
        if peak < _SILENCE_PEAK:
            raise ValueError(
                "That recording came through silent — check your microphone isn't muted and that the right "
                "input device is selected, then try again."
            )

        try:
            # Already decoded above, so hand the samples over directly rather
            # than making faster-whisper decode the same bytes a second time.
            segments, _info = model.transcribe(audio, vad_filter=True, language="en")
            segments = list(segments)
        except Exception as err:  # noqa: BLE001
            raise EngineUnavailable(f"Local transcription failed: {err}") from err

    if not segments:
        return "", 0.0, 0.0

    text = " ".join(s.text.strip() for s in segments).strip()
    avg_logprob = sum(s.avg_logprob for s in segments) / len(segments)
    # avg_logprob is typically in roughly [-1, 0]; clamp/rescale to a 0-1 proxy.
    confidence = max(0.0, min(1.0, 1.0 + avg_logprob))
    speech_seconds = round(sum(max(0.0, s.end - s.start) for s in segments), 2)
    return text, confidence, speech_seconds


# How much audio the model sees at once. Ten minutes costs ~38 MB as float32
# and is long enough that window boundaries are rare; the figure trades memory
# against how often a sentence has to be stitched across a seam.
WINDOW_SECONDS = 600.0
# How far back from a window's end we are willing to cut in order to land on a
# sentence boundary. Bounds the worst case: every window advances at least
# WINDOW_SECONDS - TAIL_GUARD_SECONDS, so the loop always terminates.
TAIL_GUARD_SECONDS = 30.0


def transcribe_file(
    path: str,
    *,
    on_segment,
    on_progress=None,
    should_cancel=None,
    language: str = "en",
) -> int:
    """Transcribe a whole media file into timed segments (spec §4.1.2,
    "automatic subtitle generation"). Returns the number of segments emitted.

    `on_segment(start_ms, end_ms, text)` is called as each segment is decoded
    rather than at the end, so a two-hour film produces a usable, growing
    track instead of nothing for twenty minutes. `should_cancel()` is polled
    between windows so the user can stop a job they started by mistake.

    **Read in windows, never whole.** Handing the path to faster-whisper makes
    it decode the entire file into RAM first — measured at 1,162 MB peak for a
    two-hour film, which is what made transcribing a movie kill the app on the
    hardware tier this targets. Memory here is flat in the length of the film:
    one window of audio at a time, ~38 MB, whether the file is ten minutes or
    four hours.

    Boundaries are stitched on sentence ends rather than on the clock. Whisper
    cannot know that a window stopped mid-sentence, so the last segment of each
    window is discarded and the next window starts where the last *kept*
    segment ended — the discarded audio is re-read and transcribed with its
    full context instead of being cut in half.

    Holds `_lock` for the entire run, for the reason given on
    _load_model_locked. The consequence is real and deliberate: while a file
    is transcribing, Conversation's own speech recognition waits. One STT
    model is loaded at a time on the hardware tier this app targets, and
    running a second would be an out-of-memory kill rather than a slowdown —
    so the caller (media/tracks.py) allows only one generation job at a time
    and says plainly in the UI that it is running.
    """
    from app.services.voice import audio_windows

    source = Path(path)
    total_s = audio_windows.duration_seconds(source)
    emitted = 0
    position_s = 0.0

    def report(seconds: float) -> None:
        if on_progress is not None and total_s > 0:
            on_progress(min(1.0, seconds / total_s))

    with _lock:
        model = _load_model_locked()
        try:
            while True:
                if should_cancel is not None and should_cancel():
                    break

                window = audio_windows.read_window(source, position_s, WINDOW_SECONDS)
                if window.size == 0:
                    break
                window_s = window.size / audio_windows.SAMPLE_RATE
                # Short read means end of file, so nothing after this window
                # can complete a sentence and the final segment is kept.
                is_last = window_s < WINDOW_SECONDS - 1.0

                segments, _info = model.transcribe(window, vad_filter=True, language=language)
                segments = [s for s in segments if (s.text or "").strip()]
                # Free the samples before the next window is read, so peak
                # memory is one window rather than two.
                del window

                if not segments:
                    position_s += window_s
                    report(position_s)
                    if is_last:
                        break
                    continue

                # Decide whether the trailing segment can be trusted. Dropping
                # it is only safe if we then resume at ITS start, so the audio
                # is transcribed again with full context rather than skipped —
                # resuming anywhere later loses the sentence outright.
                tail = segments[-1]
                resume_at = tail.start
                if is_last or len(segments) == 1 or resume_at < WINDOW_SECONDS - TAIL_GUARD_SECONDS:
                    # Either there is nothing after this window to complete the
                    # sentence, or backing up to it would mean re-reading most
                    # of the window. Keep it: a sentence that may be clipped is
                    # better than one that is lost, and better than a crawl.
                    keep = segments
                    resume_at = window_s
                else:
                    keep = segments[:-1]

                for segment in keep:
                    on_segment(
                        int((position_s + segment.start) * 1000),
                        int((position_s + segment.end) * 1000),
                        segment.text.strip(),
                    )
                    emitted += 1

                if is_last:
                    report(total_s or position_s + window_s)
                    break

                # resume_at is either the dropped sentence's start or a whole
                # window; both are at least WINDOW - TAIL_GUARD, so the loop
                # always moves forward and always terminates.
                position_s += resume_at
                report(position_s)
        except Exception as err:  # noqa: BLE001
            raise EngineUnavailable(f"Local transcription failed: {err}") from err

    if on_progress is not None:
        on_progress(1.0)
    return emitted
