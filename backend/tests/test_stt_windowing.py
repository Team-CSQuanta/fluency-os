"""Windowed transcription of long media.

Transcribing a film used to decode the whole thing into RAM — measured at
1,162 MB peak for two hours, on a tier that cannot spare it, which crashed the
app. Audio is now read one window at a time.

What is tested here is the stitching, because that is where the subtle bugs
are: timestamps have to stay absolute across windows, sentences must not be
cut at a window boundary, and the loop must always make progress. A window
that advanced by zero would hang the app rather than crash it, which is worse.
"""

from dataclasses import dataclass

import numpy as np
import pytest

from app.services.voice import audio_windows, stt_engine

SR = audio_windows.SAMPLE_RATE
WINDOW = stt_engine.WINDOW_SECONDS


@dataclass
class FakeSegment:
    start: float
    end: float
    text: str


class FakeModel:
    """Returns whatever the test queued for each successive window."""

    def __init__(self, per_window):
        self.per_window = list(per_window)
        self.seen_samples = []
        self.calls = 0

    def transcribe(self, audio, **kwargs):
        self.seen_samples.append(len(audio))
        segments = self.per_window[self.calls] if self.calls < len(self.per_window) else []
        self.calls += 1
        return iter(segments), object()


@pytest.fixture()
def harness(monkeypatch):
    """Drives transcribe_file over a synthetic file of a chosen length."""

    def build(total_s, per_window):
        model = FakeModel(per_window)
        monkeypatch.setattr(stt_engine, "_load_model_locked", lambda: model)
        monkeypatch.setattr(audio_windows, "duration_seconds", lambda path: total_s)

        reads = []

        def fake_read(path, start_s, duration_s):
            reads.append(round(start_s, 3))
            remaining = max(0.0, total_s - start_s)
            length = min(duration_s, remaining)
            return np.zeros(int(length * SR), dtype=np.float32)

        monkeypatch.setattr(audio_windows, "read_window", fake_read)

        emitted = []
        progress = []
        count = stt_engine.transcribe_file(
            "/tmp/film.mkv",
            on_segment=lambda s, e, t: emitted.append((s, e, t)),
            on_progress=progress.append,
        )
        return model, reads, emitted, progress, count

    return build


def test_timestamps_stay_absolute_across_windows(harness):
    """A segment 30 s into the third window is at 20:30 in the film, not 0:30."""
    model, reads, emitted, _p, count = harness(
        WINDOW * 3,
        [
            [FakeSegment(10, 20, "first window"), FakeSegment(WINDOW - 5, WINDOW, "tail A")],
            [FakeSegment(5, 15, "second window"), FakeSegment(WINDOW - 5, WINDOW, "tail B")],
            [FakeSegment(30, 40, "third window")],
        ],
    )
    assert emitted[0] == (10_000, 20_000, "first window")
    # Window 2 resumes at the dropped tail segment's start (WINDOW - 5), so
    # that sentence is re-read whole rather than skipped.
    resume = WINDOW - 5
    assert emitted[1] == (int((resume + 5) * 1000), int((resume + 15) * 1000), "second window")
    assert count == len(emitted)


def test_the_last_segment_of_a_window_is_re_read_not_cut_in_half(harness):
    """Whisper cannot know the audio stopped mid-sentence, so the trailing
    segment is dropped and its audio transcribed again with full context."""
    model, reads, emitted, _p, _c = harness(
        WINDOW * 2,
        [
            [FakeSegment(100, 200, "kept"), FakeSegment(WINDOW - 10, WINDOW, "truncated mid-sentence")],
            [FakeSegment(0, 30, "read again properly")],
        ],
    )
    assert [t for _s, _e, t in emitted] == ["kept", "read again properly"]
    # The second read begins at the DROPPED segment's start, so its audio is
    # transcribed again with full context instead of being lost.
    assert reads[1] == WINDOW - 10


def test_a_window_of_music_advances_a_whole_window(harness):
    """Speech that stops long before the window ends leaves no sentence to
    preserve — backing up to it would re-read minutes of audio per window."""
    model, reads, emitted, _p, _c = harness(
        WINDOW * 2,
        [[FakeSegment(1, 4, "a single line then silence")], [FakeSegment(10, 20, "next")]],
    )
    assert reads[:2] == [0.0, WINDOW]
    assert len(emitted) == 2


def test_a_silent_window_still_advances(harness):
    model, reads, emitted, _p, _c = harness(WINDOW * 2, [[], [FakeSegment(5, 9, "speech at last")]])
    assert reads[:2] == [0.0, WINDOW]
    assert emitted == [(int((WINDOW + 5) * 1000), int((WINDOW + 9) * 1000), "speech at last")]


def test_every_window_advances_by_a_bounded_minimum(harness):
    """The guarantee that makes this terminate: whatever the model returns,
    the read position moves forward by at least WINDOW - TAIL_GUARD."""
    model, reads, _e, _p, _c = harness(
        WINDOW * 4,
        [[FakeSegment(0, 1, "x"), FakeSegment(WINDOW - 2, WINDOW, "y")]] * 5,
    )
    advances = [b - a for a, b in zip(reads, reads[1:])]
    assert advances, "expected more than one window"
    assert min(advances) >= WINDOW - stt_engine.TAIL_GUARD_SECONDS


def test_a_single_segment_spanning_the_whole_window_is_not_dropped(harness):
    """Dropping the only segment would emit nothing and re-read the same
    audio for ever — the one shape that could hang instead of finish."""
    model, reads, emitted, _p, _c = harness(
        WINDOW * 2,
        [[FakeSegment(0, WINDOW, "one long unbroken take")], [FakeSegment(1, 5, "after")]],
    )
    assert [t for _s, _e, t in emitted] == ["one long unbroken take", "after"]
    assert reads[1] > reads[0]


def test_a_short_file_is_one_window_and_keeps_its_final_segment(harness):
    model, reads, emitted, _p, count = harness(
        45.0, [[FakeSegment(1, 5, "hello"), FakeSegment(40, 44, "goodbye")]]
    )
    assert reads == [0.0]
    assert [t for _s, _e, t in emitted] == ["hello", "goodbye"]
    assert count == 2


def test_only_one_window_of_audio_is_held_at_a_time(harness):
    """The whole point: the model never sees more than a window, however long
    the film is."""
    model, _r, _e, _p, _c = harness(WINDOW * 6, [[FakeSegment(0, 5, "s")]] * 8)
    assert max(model.seen_samples) <= int(WINDOW * SR)


def test_progress_is_reported_against_the_real_duration(harness):
    _m, _r, _e, progress, _c = harness(WINDOW * 3, [[FakeSegment(0, 5, "s")]] * 4)
    assert progress, "expected progress callbacks"
    assert progress[-1] == 1.0
    assert all(0.0 <= value <= 1.0 for value in progress)
    assert progress == sorted(progress), "progress must not go backwards"


def test_cancelling_stops_between_windows(monkeypatch):
    model = FakeModel([[FakeSegment(0, 5, "one")]] * 10)
    monkeypatch.setattr(stt_engine, "_load_model_locked", lambda: model)
    monkeypatch.setattr(audio_windows, "duration_seconds", lambda path: WINDOW * 10)
    monkeypatch.setattr(
        audio_windows, "read_window", lambda p, s, d: np.zeros(int(d * SR), dtype=np.float32)
    )

    emitted = []
    stt_engine.transcribe_file(
        "/tmp/film.mkv",
        on_segment=lambda s, e, t: emitted.append(t),
        should_cancel=lambda: len(emitted) >= 2,
    )
    assert len(emitted) == 2
    assert model.calls <= 3


def test_reading_past_the_end_of_the_file_ends_the_run(harness):
    """EOF is detected from a short read, so a wrong duration cannot cause an
    endless loop."""
    model, reads, _e, _p, _c = harness(WINDOW * 1.5, [[FakeSegment(0, 5, "a")]] * 4)
    assert len(reads) == 2


def test_windows_always_cover_the_whole_file_with_no_gaps(harness):
    """The invariant an earlier version of this loop broke: when the trailing
    segment was dropped, the position could still advance a whole window, so
    that sentence was never transcribed by anyone. Every point in the file has
    to fall inside some window that was actually read."""
    total = WINDOW * 5
    model, reads, _e, _p, _c = harness(
        total,
        [[FakeSegment(0, 2, "a"), FakeSegment(WINDOW - 8, WINDOW, "tail")]] * 8,
    )
    covered_to = 0.0
    for start in reads:
        assert start <= covered_to + 1e-6, f"gap in coverage before {start}s"
        covered_to = max(covered_to, min(start + WINDOW, total))
    assert covered_to >= total


@pytest.mark.parametrize("seed", range(25))
def test_the_loop_terminates_and_never_skips_audio_whatever_the_model_returns(harness, seed):
    """Randomised layouts, because the failure modes here are a hang and a
    silent gap — neither of which shows up as an exception."""
    import random

    rng = random.Random(seed)
    total = WINDOW * rng.randint(1, 4)

    def layout():
        count = rng.randint(0, 4)
        segments = []
        cursor = rng.uniform(0, 30)
        for _ in range(count):
            length = rng.uniform(0.5, WINDOW / 2)
            start = min(cursor, WINDOW - 0.5)
            end = min(start + length, WINDOW)
            if end > start:
                segments.append(FakeSegment(start, end, "x"))
            cursor = end + rng.uniform(0, 60)
            if cursor >= WINDOW:
                break
        return segments

    model, reads, _e, _p, _c = harness(total, [layout() for _ in range(60)])

    assert len(reads) < 60, "loop failed to make progress"
    covered_to = 0.0
    for start in reads:
        assert start <= covered_to + 1e-6, f"seed {seed}: gap before {start}s"
        covered_to = max(covered_to, min(start + WINDOW, total))
    assert covered_to >= total, f"seed {seed}: file not fully covered"
