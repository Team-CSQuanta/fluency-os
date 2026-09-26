"""Subtitle parsing and clip-window maths — the two pieces of this feature
that are pure functions, and therefore the two worth testing exhaustively."""

import pytest

from app.services.media import clips, library, subtitles, tracks


# --------------------------------------------------------------------------
# parsing


def test_srt_with_crlf_and_markup():
    raw = (
        b"1\r\n00:00:01,000 --> 00:00:04,500\r\n<i>She was reticent</i> about\r\nthe findings.\r\n\r\n"
        b"2\r\n00:00:05,000 --> 00:00:07,000\r\nEven with her own team.\r\n"
    )
    cues = subtitles.parse(raw, suffix=".srt")
    assert [(c.start_ms, c.end_ms) for c in cues] == [(1000, 4500), (5000, 7000)]
    # The subtitler's on-screen line break is not a sentence break.
    assert cues[0].text == "She was reticent about the findings."


def test_vtt_without_hours_and_with_cue_settings():
    raw = b"WEBVTT\n\nNOTE this is a comment\n\n00:01.000 --> 00:04.000 align:start position:10%\nHello world\n"
    cues = subtitles.parse(raw, suffix=".vtt")
    assert cues == [subtitles.Cue(1000, 4000, "Hello world")]


def test_ass_reads_field_order_from_its_format_line():
    """The Text column is not always index 9 — a parser that assumes it is
    silently returns the Effect column instead."""
    raw = (
        b"[Events]\n"
        b"Format: Layer, Start, End, Style, Actor, Effect, Text\n"
        b"Dialogue: 0,0:00:01.00,0:00:03.50,Default,,,{\\an8}Hello, there\\Nfriend\n"
    ).replace(b"\\\\", b"\\")
    cues = subtitles.parse(raw, suffix=".ass")
    assert cues == [subtitles.Cue(1000, 3500, "Hello, there friend")]


def test_ass_centiseconds_are_not_milliseconds():
    raw = b"[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n" \
          b"Dialogue: 0,0:00:01.50,0:00:03.25,Default,,0,0,0,,Line\n"
    cues = subtitles.parse(raw, suffix=".ass")
    assert cues[0].start_ms == 1500 and cues[0].end_ms == 3250


def test_cp1252_curly_quotes_survive():
    raw = "1\n00:00:01,000 --> 00:00:02,000\nIt’s “fine”\n".encode("cp1252")
    cues = subtitles.parse(raw, suffix=".srt")
    assert cues[0].text == "It’s “fine”"


def test_utf8_bom_is_not_left_in_the_first_cue():
    raw = "1\n00:00:01,000 --> 00:00:02,000\nHello\n".encode("utf-8-sig")
    assert subtitles.parse(raw, suffix=".srt")[0].text == "Hello"


def test_a_vtt_file_named_srt_still_parses():
    """Renamed subtitle files are common; extension is a hint, not a fact."""
    raw = b"WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello\n"
    assert subtitles.parse(raw, suffix=".srt")[0].text == "Hello"


def test_unparseable_bytes_raise_rather_than_returning_nothing():
    with pytest.raises(subtitles.SubtitleParseError):
        subtitles.parse(b"not a subtitle file at all", suffix=".srt")


def test_normalise_drops_zero_length_and_sorts():
    cues = [subtitles.Cue(5000, 6000, "b"), subtitles.Cue(1000, 1000, "zero"), subtitles.Cue(1000, 2000, "a")]
    assert subtitles.normalise(cues) == [subtitles.Cue(1000, 2000, "a"), subtitles.Cue(5000, 6000, "b")]


def test_vtt_round_trip():
    cues = [subtitles.Cue(1000, 4500, "One"), subtitles.Cue(3_661_000, 3_662_000, "Two")]
    assert subtitles.parse(subtitles.to_vtt(cues).encode(), suffix=".vtt") == cues


# --------------------------------------------------------------------------
# clip windows (spec §4.2 steps 1-3)


def test_window_applies_default_padding():
    w = clips.window_for(
        cue_start_ms=10_000, cue_end_ms=13_000,
        pad_before_ms=1000, pad_after_ms=500, max_ms=10_000, duration_ms=600_000,
    )
    assert (w.start_ms, w.end_ms) == (9000, 13_500)


def test_window_clamps_to_the_start_of_the_file():
    w = clips.window_for(
        cue_start_ms=200, cue_end_ms=1500,
        pad_before_ms=1000, pad_after_ms=500, max_ms=10_000, duration_ms=600_000,
    )
    assert w.start_ms == 0


def test_window_does_not_open_on_the_previous_line():
    w = clips.window_for(
        cue_start_ms=10_000, cue_end_ms=12_000,
        pad_before_ms=1000, pad_after_ms=500, max_ms=10_000, duration_ms=600_000,
        prev_cue_end_ms=9_600, next_cue_start_ms=12_200,
    )
    assert (w.start_ms, w.end_ms) == (9_600, 12_200)


def test_window_caps_long_cue_by_trimming_the_tail():
    """The looked-up word is at the start of the line, so a 40 s monologue
    loses its end, not its beginning."""
    w = clips.window_for(
        cue_start_ms=10_000, cue_end_ms=50_000,
        pad_before_ms=1000, pad_after_ms=500, max_ms=10_000, duration_ms=600_000,
    )
    assert (w.start_ms, w.end_ms) == (9_000, 19_000)
    assert w.duration_ms == 10_000


def test_window_never_ends_past_the_file():
    w = clips.window_for(
        cue_start_ms=598_000, cue_end_ms=599_800,
        pad_before_ms=1000, pad_after_ms=5000, max_ms=10_000, duration_ms=600_000,
    )
    assert w.end_ms == 600_000


def test_window_survives_neighbours_that_leave_no_room():
    """Back-to-back cues would clamp the window to nothing; the cue's own
    span has to win, or the save produces an unplayable zero-length clip."""
    w = clips.window_for(
        cue_start_ms=10_000, cue_end_ms=11_000,
        pad_before_ms=1000, pad_after_ms=500, max_ms=10_000, duration_ms=600_000,
        prev_cue_end_ms=10_000, next_cue_start_ms=10_000,
    )
    assert w.duration_ms > 0
    assert (w.start_ms, w.end_ms) == (10_000, 11_000)


# --------------------------------------------------------------------------
# filename handling


@pytest.mark.parametrize(
    "filename,expected",
    [
        ("Arrival.2016.1080p.BluRay.x264-GROUP.mkv", "Arrival (2016)"),
        ("Interstellar.mkv", "Interstellar"),
        ("Everything Everywhere All at Once.mp4", "Everything Everywhere All at Once"),
        ("Dune.2021.2160p.mkv", "Dune (2021)"),
        ("chefs_table_s01e02.mp4", "chefs table s01e02"),
    ],
)
def test_title_from_filename(filename, expected):
    from pathlib import Path

    assert library.title_from_filename(Path(filename)) == expected


def test_sidecar_matching_does_not_pull_in_a_different_film(tmp_path):
    from pathlib import Path

    video = tmp_path / "Film.mkv"
    video.write_bytes(b"x")
    (tmp_path / "Film.srt").write_text("1\n00:00:01,000 --> 00:00:02,000\na\n")
    (tmp_path / "Film.en.srt").write_text("1\n00:00:01,000 --> 00:00:02,000\nb\n")
    (tmp_path / "Film 2.srt").write_text("1\n00:00:01,000 --> 00:00:02,000\nc\n")
    (tmp_path / "OtherFilm.srt").write_text("1\n00:00:01,000 --> 00:00:02,000\nd\n")

    found = {p.name for p in tracks.find_sidecars(Path(video))}
    assert found == {"Film.srt", "Film.en.srt"}


def test_language_is_read_from_a_sidecar_filename():
    from pathlib import Path

    assert tracks.language_from_filename(Path("Film.en.srt")) == "en"
    assert tracks.language_from_filename(Path("Film.eng.forced.srt")) == "eng"
    assert tracks.language_from_filename(Path("Film.srt")) is None
