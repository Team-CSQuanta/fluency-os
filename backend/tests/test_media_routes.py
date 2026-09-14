"""End-to-end tests for Learn by watching, against a real video file.

A genuine MKV is built with ffmpeg rather than mocked, because every bug this
feature can have lives in the seam between our code and ffmpeg's: stream
indices, embedded-track demuxing, byte ranges, keyframe seeking. A fake would
test the parts that were never in doubt.

The whole module skips when ffmpeg is absent, and says so — the feature is
honest about needing it (see /media/import) and the suite should be too.
"""

import subprocess

import pytest

from app.services.media import ffmpeg

pytestmark = pytest.mark.skipif(not ffmpeg.is_available(), reason="ffmpeg/ffprobe not installed")

SRT_EN = """1
00:00:01,000 --> 00:00:04,500
She was reticent about the findings.

2
00:00:05,000 --> 00:00:08,000
Even with her own team.

3
00:00:09,000 --> 00:00:12,000
That was the last straw.
"""

SRT_BN = """1
00:00:01,000 --> 00:00:04,500
Line one.

2
00:00:05,000 --> 00:00:08,000
Line two.

3
00:00:09,000 --> 00:00:12,000
Line three.
"""


@pytest.fixture()
def video(tmp_path):
    """A 14-second file with one video, one audio and two subtitle streams."""
    en = tmp_path / "en.srt"
    bn = tmp_path / "bn.srt"
    en.write_text(SRT_EN)
    bn.write_text(SRT_BN)
    dest = tmp_path / "Arrival.2016.1080p.BluRay.x264-GROUP.mkv"
    subprocess.run(
        [
            str(ffmpeg.ffmpeg_path()), "-hide_banner", "-loglevel", "error",
            "-f", "lavfi", "-i", "testsrc=size=320x180:rate=12:duration=14",
            "-f", "lavfi", "-i", "sine=frequency=440:duration=14",
            "-i", str(en), "-i", str(bn),
            "-map", "0:v", "-map", "1:a", "-map", "2", "-map", "3",
            "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-c:s", "srt",
            "-metadata:s:s:0", "language=eng", "-metadata:s:s:1", "language=ben",
            "-y", str(dest),
        ],
        check=True,
        capture_output=True,
    )
    return dest


def _user(client, auth_headers):
    res = client.post(
        "/users",
        headers=auth_headers,
        json={
            "display_name": "Watcher",
            "native_language": "bn",
            "target_language": "en",
            "data_folder": "~/FluencyOS",
        },
    )
    assert res.status_code == 201
    return res.json()["id"]


def _import(client, auth_headers, video):
    user_id = _user(client, auth_headers)
    res = client.post(
        "/media/import", headers=auth_headers, json={"user_id": user_id, "paths": [str(video)]}
    )
    assert res.status_code == 202
    return user_id, res.json()[0]["id"]


def test_import_probes_the_file_and_reads_a_title_from_the_release_name(client, auth_headers, video):
    _user_id, media_id = _import(client, auth_headers, video)
    item = client.get(f"/media/{media_id}", headers=auth_headers).json()["item"]

    assert item["title"] == "Arrival (2016)"
    assert item["ingest_status"] == "ready"
    assert 13_500 < item["duration_ms"] < 14_500
    assert (item["width"], item["height"]) == (320, 180)
    assert item["video_codec"] == "h264"
    assert item["has_thumbnail"] is True


def test_embedded_subtitle_tracks_are_demuxed_into_cues(client, auth_headers, video):
    _user_id, media_id = _import(client, auth_headers, video)
    detail = client.get(f"/media/{media_id}", headers=auth_headers).json()

    subs = [t for t in detail["tracks"] if t["kind"] == "subtitle"]
    assert len(subs) == 2
    assert all(t["status"] == "ready" and t["cue_count"] == 3 for t in subs)
    assert {t["language"] for t in subs} == {"eng", "ben"}
    assert [t for t in detail["tracks"] if t["kind"] == "audio"]


def test_dual_subtitles_are_auto_selected_with_the_target_language_first(client, auth_headers, video):
    _user_id, media_id = _import(client, auth_headers, video)
    detail = client.get(f"/media/{media_id}", headers=auth_headers).json()
    by_id = {t["id"]: t for t in detail["tracks"]}

    assert by_id[detail["prefs"]["target_track_id"]]["language"] == "eng"
    assert by_id[detail["prefs"]["native_track_id"]]["language"] == "ben"


def test_cues_carry_real_text_and_timecodes(client, auth_headers, video):
    _user_id, media_id = _import(client, auth_headers, video)
    detail = client.get(f"/media/{media_id}", headers=auth_headers).json()
    cues = client.get(f"/media/tracks/{detail['prefs']['target_track_id']}/cues", headers=auth_headers).json()

    assert [c["text"] for c in cues] == [
        "She was reticent about the findings.",
        "Even with her own team.",
        "That was the last straw.",
    ]
    assert [c["order_index"] for c in cues] == [0, 1, 2]
    assert 900 < cues[0]["start_ms"] < 1100


def test_stream_serves_byte_ranges_so_the_player_can_seek(client, auth_headers, video):
    """Without a 206 the <video> element downloads the whole film before it
    will scrub — the single thing that decides whether the player is usable."""
    _user_id, media_id = _import(client, auth_headers, video)
    res = client.get(f"/media/{media_id}/stream?t=test-token", headers={"Range": "bytes=0-1023"})

    assert res.status_code == 206
    assert res.headers["accept-ranges"] == "bytes"
    assert res.headers["content-range"].startswith("bytes 0-1023/")
    assert len(res.content) == 1024


def test_stream_rejects_a_request_with_no_token(client, auth_headers, video):
    _user_id, media_id = _import(client, auth_headers, video)
    assert client.get(f"/media/{media_id}/stream").status_code == 401
    assert client.get(f"/media/{media_id}/stream?t=wrong").status_code == 401


def test_importing_the_same_file_twice_does_not_duplicate_it(client, auth_headers, video):
    user_id, media_id = _import(client, auth_headers, video)
    again = client.post(
        "/media/import", headers=auth_headers, json={"user_id": user_id, "paths": [str(video)]}
    )
    assert again.json()[0]["id"] == media_id
    assert client.get(f"/media?user_id={user_id}", headers=auth_headers).json()["counts"]["all"] == 1


def test_a_file_that_is_not_a_video_gets_a_card_that_says_why(client, auth_headers, tmp_path):
    """Dropping the wrong file must not silently vanish — the user picked it
    and is owed an explanation attached to the thing they picked."""
    user_id = _user(client, auth_headers)
    junk = tmp_path / "notes.txt"
    junk.write_text("hello")
    res = client.post("/media/import", headers=auth_headers, json={"user_id": user_id, "paths": [str(junk)]})

    item = res.json()[0]
    assert item["ingest_status"] == "failed"
    assert "isn't a video format" in item["ingest_error"]


def test_missing_file_is_reported_rather_than_dropped(client, auth_headers, tmp_path):
    user_id = _user(client, auth_headers)
    res = client.post(
        "/media/import", headers=auth_headers, json={"user_id": user_id, "paths": [str(tmp_path / "gone.mkv")]}
    )
    assert res.json()[0]["ingest_status"] == "failed"


def test_progress_is_stored_and_drives_continue_watching(client, auth_headers, video):
    user_id, media_id = _import(client, auth_headers, video)
    res = client.put(
        f"/media/{media_id}/progress",
        headers=auth_headers,
        json={"user_id": user_id, "position_ms": 7000, "watched_delta_ms": 7000},
    )
    assert res.status_code == 200
    assert 45 < res.json()["percent_complete"] < 55

    library = client.get(f"/media?user_id={user_id}", headers=auth_headers).json()
    assert [i["id"] for i in library["recent"]] == [media_id]
    assert library["counts"]["unfinished"] == 1


def test_a_finished_film_leaves_continue_watching(client, auth_headers, video):
    user_id, media_id = _import(client, auth_headers, video)
    client.put(
        f"/media/{media_id}/progress",
        headers=auth_headers,
        json={"user_id": user_id, "position_ms": 14_000, "watched_delta_ms": 14_000},
    )
    library = client.get(f"/media?user_id={user_id}", headers=auth_headers).json()
    assert library["recent"] == []


def test_watch_time_accumulates_but_seeking_does_not_inflate_it(client, auth_headers, video):
    user_id, media_id = _import(client, auth_headers, video)
    for position, delta in ((2000, 2000), (12_000, 1000)):
        res = client.put(
            f"/media/{media_id}/progress",
            headers=auth_headers,
            json={"user_id": user_id, "position_ms": position, "watched_delta_ms": delta},
        )
    assert res.json()["total_watch_ms"] == 3000
    assert res.json()["position_ms"] == 12_000


def test_saving_a_word_stores_the_line_the_timecode_and_a_real_clip(client, auth_headers, video):
    user_id, media_id = _import(client, auth_headers, video)
    detail = client.get(f"/media/{media_id}", headers=auth_headers).json()
    cue = client.get(
        f"/media/tracks/{detail['prefs']['target_track_id']}/cues", headers=auth_headers
    ).json()[0]

    res = client.post(
        f"/media/{media_id}/save-word",
        headers=auth_headers,
        json={
            "user_id": user_id,
            "word": "reticent",
            "cue_id": cue["id"],
            "cue_text": cue["text"],
            "start_ms": cue["start_ms"],
            "end_ms": cue["end_ms"],
            "pos": "adjective",
            "definition": "Not revealing one's thoughts readily.",
            "ipa": "/ˈretɪsnt/",
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["context_added"] is True
    assert body["clip"]["status"] in ("queued", "extracting", "ready")

    clip_id = body["clip"]["id"]
    clips = client.get(f"/media/clips/list?user_id={user_id}", headers=auth_headers).json()
    assert clips[0]["status"] == "ready"
    assert clips[0]["clip_bytes"] > 0

    file_res = client.get(f"/media/clips/{clip_id}/file?t=test-token")
    assert file_res.status_code == 200
    assert len(file_res.content) > 0
    assert client.get(f"/media/clips/{clip_id}/thumbnail?t=test-token").status_code == 200


def test_the_saved_word_carries_a_replayable_clip_context(client, auth_headers, video):
    user_id, media_id = _import(client, auth_headers, video)
    detail = client.get(f"/media/{media_id}", headers=auth_headers).json()
    cue = client.get(
        f"/media/tracks/{detail['prefs']['target_track_id']}/cues", headers=auth_headers
    ).json()[0]
    client.post(
        f"/media/{media_id}/save-word",
        headers=auth_headers,
        json={
            "user_id": user_id, "word": "reticent", "cue_id": cue["id"], "cue_text": cue["text"],
            "start_ms": cue["start_ms"], "end_ms": cue["end_ms"], "definition": "Reserved.",
        },
    )

    word = client.get(f"/vocabulary/by-word/reticent?user_id={user_id}", headers=auth_headers).json()
    context = word["contexts"][0]
    assert context["kind"] == "clip"
    assert context["snippet"] == cue["text"]
    assert context["media_item_id"] == media_id
    assert context["start_ms"] == cue["start_ms"]
    assert context["clip_status"] == "ready"
    assert context["source_label"].startswith("Arrival (2016) · 0:0")


def test_saving_the_same_line_twice_does_not_make_a_second_clip(client, auth_headers, video):
    user_id, media_id = _import(client, auth_headers, video)
    detail = client.get(f"/media/{media_id}", headers=auth_headers).json()
    cue = client.get(
        f"/media/tracks/{detail['prefs']['target_track_id']}/cues", headers=auth_headers
    ).json()[0]
    payload = {
        "user_id": user_id, "word": "reticent", "cue_id": cue["id"], "cue_text": cue["text"],
        "start_ms": cue["start_ms"], "end_ms": cue["end_ms"], "definition": "Reserved.",
    }
    client.post(f"/media/{media_id}/save-word", headers=auth_headers, json=payload)
    second = client.post(f"/media/{media_id}/save-word", headers=auth_headers, json=payload)

    assert second.json()["already_saved"] is True
    assert second.json()["context_added"] is False
    assert second.json()["clip"] is None
    assert len(client.get(f"/media/clips/list?user_id={user_id}", headers=auth_headers).json()) == 1


def test_the_same_word_met_at_a_different_moment_gets_its_own_clip(client, auth_headers, video):
    """Two encounters are two contexts — that is the point of the clip
    engine, and de-duping on the word alone would throw the second away."""
    user_id, media_id = _import(client, auth_headers, video)
    detail = client.get(f"/media/{media_id}", headers=auth_headers).json()
    cues = client.get(f"/media/tracks/{detail['prefs']['target_track_id']}/cues", headers=auth_headers).json()

    for cue in cues[:2]:
        client.post(
            f"/media/{media_id}/save-word",
            headers=auth_headers,
            json={
                "user_id": user_id, "word": "reticent", "cue_id": cue["id"], "cue_text": cue["text"],
                "start_ms": cue["start_ms"], "end_ms": cue["end_ms"], "definition": "Reserved.",
            },
        )
    word = client.get(f"/vocabulary/by-word/reticent?user_id={user_id}", headers=auth_headers).json()
    assert len(word["contexts"]) == 2


def test_a_sidecar_subtitle_file_can_be_attached(client, auth_headers, video, tmp_path):
    _user_id, media_id = _import(client, auth_headers, video)
    sidecar = tmp_path / "extra.fr.srt"
    sidecar.write_text("1\n00:00:02,000 --> 00:00:03,000\nBonjour\n")

    res = client.post(
        f"/media/{media_id}/tracks/sidecar", headers=auth_headers, json={"path": str(sidecar), "role": "native"}
    )
    assert res.status_code == 200
    assert res.json()["origin"] == "sidecar"
    assert res.json()["language"] == "fr"
    assert res.json()["cue_count"] == 1


def test_an_unreadable_sidecar_is_refused_with_a_reason(client, auth_headers, video, tmp_path):
    _user_id, media_id = _import(client, auth_headers, video)
    junk = tmp_path / "junk.srt"
    junk.write_text("this is not a subtitle file")
    res = client.post(f"/media/{media_id}/tracks/sidecar", headers=auth_headers, json={"path": str(junk)})
    assert res.status_code == 422


def test_track_and_playback_preferences_persist(client, auth_headers, video):
    _user_id, media_id = _import(client, auth_headers, video)
    detail = client.get(f"/media/{media_id}", headers=auth_headers).json()
    other = next(t for t in detail["tracks"] if t["kind"] == "subtitle" and t["language"] == "ben")

    client.put(
        f"/media/{media_id}/prefs",
        headers=auth_headers,
        json={"target_track_id": other["id"], "subtitle_delay_ms": -250, "playback_rate": 0.75},
    )
    prefs = client.get(f"/media/{media_id}", headers=auth_headers).json()["prefs"]
    assert prefs["target_track_id"] == other["id"]
    assert prefs["subtitle_delay_ms"] == -250
    assert prefs["playback_rate"] == 0.75


def test_player_preferences_work_without_an_onboarding_settings_row(client, auth_headers):
    """A learner who skipped onboarding still has to be able to open a video."""
    user_id = _user(client, auth_headers)
    res = client.get(f"/media/prefs/player?user_id={user_id}", headers=auth_headers)
    assert res.status_code == 200
    assert res.json()["clip_pad_before_ms"] == 1000
    assert res.json()["clip_max_ms"] == 10_000

    client.put(f"/media/prefs/player?user_id={user_id}", headers=auth_headers, json={"blur_subs": True})
    assert client.get(f"/media/prefs/player?user_id={user_id}", headers=auth_headers).json()["blur_subs"] is True


def test_a_moved_source_file_is_reported_as_gone_not_as_a_broken_player(client, auth_headers, video):
    user_id, media_id = _import(client, auth_headers, video)
    video.unlink()

    detail = client.get(f"/media/{media_id}", headers=auth_headers).json()
    assert detail["item"]["source_missing"] is True
    assert client.get(f"/media/{media_id}/stream?t=test-token").status_code == 410


def test_relinking_restores_a_moved_file(client, auth_headers, video, tmp_path):
    _user_id, media_id = _import(client, auth_headers, video)
    moved = tmp_path / "moved" / video.name
    moved.parent.mkdir()
    video.rename(moved)
    client.get(f"/media/{media_id}", headers=auth_headers)

    res = client.post(f"/media/{media_id}/relink", headers=auth_headers, json={"path": str(moved)})
    assert res.status_code == 200
    assert res.json()["source_missing"] is False
    assert client.get(f"/media/{media_id}/stream?t=test-token", headers={"Range": "bytes=0-99"}).status_code == 206


def test_deleting_a_library_entry_never_deletes_the_user_s_film(client, auth_headers, video):
    user_id, media_id = _import(client, auth_headers, video)
    assert client.delete(f"/media/{media_id}", headers=auth_headers).status_code == 204
    assert video.exists()
    assert client.get(f"/media?user_id={user_id}", headers=auth_headers).json()["counts"]["all"] == 0


def test_deleting_an_item_takes_its_clips_and_tracks_with_it(client, auth_headers, video):
    user_id, media_id = _import(client, auth_headers, video)
    detail = client.get(f"/media/{media_id}", headers=auth_headers).json()
    cue = client.get(
        f"/media/tracks/{detail['prefs']['target_track_id']}/cues", headers=auth_headers
    ).json()[0]
    client.post(
        f"/media/{media_id}/save-word",
        headers=auth_headers,
        json={
            "user_id": user_id, "word": "reticent", "cue_id": cue["id"], "cue_text": cue["text"],
            "start_ms": cue["start_ms"], "end_ms": cue["end_ms"], "definition": "Reserved.",
        },
    )
    client.delete(f"/media/{media_id}", headers=auth_headers)

    assert client.get(f"/media/clips/list?user_id={user_id}", headers=auth_headers).json() == []
    # The word itself survives: it is the learner's, not the film's.
    assert client.get(f"/vocabulary/by-word/reticent?user_id={user_id}", headers=auth_headers).status_code == 200


def test_library_filters(client, auth_headers, video):
    user_id, media_id = _import(client, auth_headers, video)
    counts = client.get(f"/media?user_id={user_id}", headers=auth_headers).json()["counts"]
    assert counts == {"all": 1, "local": 1, "link": 0, "unfinished": 0, "unwatched": 1, "no-subs": 0}

    assert client.get(f"/media?user_id={user_id}&q=arrival", headers=auth_headers).json()["items"]
    assert client.get(f"/media?user_id={user_id}&q=zzz", headers=auth_headers).json()["items"] == []


def test_generating_subtitles_refuses_clearly_when_the_model_is_absent(client, auth_headers, video):
    """The STT model is a large optional download; asking for a transcript
    without it must say so rather than fail somewhere inside a worker."""
    user_id, media_id = _import(client, auth_headers, video)
    res = client.post(
        f"/media/{media_id}/tracks/generate", headers=auth_headers, json={"user_id": user_id, "language": "en"}
    )
    assert res.status_code in (202, 503)
    if res.status_code == 503:
        assert "isn't downloaded" in res.json()["detail"]


def test_timecodes_only_storage_rebuilds_the_clip_on_demand(client, auth_headers, video):
    """Spec §4.2 storage policy. With clip_storage_mode = 'on_demand' nothing
    is written at save time, and the clip is cut from the source when it is
    actually asked for."""
    user_id, media_id = _import(client, auth_headers, video)
    client.put(
        f"/media/prefs/player?user_id={user_id}", headers=auth_headers, json={"clip_store_files": False}
    )

    detail = client.get(f"/media/{media_id}", headers=auth_headers).json()
    cue = client.get(
        f"/media/tracks/{detail['prefs']['target_track_id']}/cues", headers=auth_headers
    ).json()[1]
    res = client.post(
        f"/media/{media_id}/save-word",
        headers=auth_headers,
        json={
            "user_id": user_id, "word": "team", "cue_id": cue["id"], "cue_text": cue["text"],
            "start_ms": cue["start_ms"], "end_ms": cue["end_ms"], "definition": "A group.",
        },
    )
    clip = res.json()["clip"]
    assert clip["status"] == "virtual"
    assert clip["clip_bytes"] == 0

    rebuilt = client.get(f"/media/clips/{clip['id']}/file?t=test-token")
    assert rebuilt.status_code == 200
    assert len(rebuilt.content) > 0


def test_a_clip_whose_source_vanished_fails_with_something_to_do(client, auth_headers, video):
    user_id, media_id = _import(client, auth_headers, video)
    detail = client.get(f"/media/{media_id}", headers=auth_headers).json()
    cue = client.get(
        f"/media/tracks/{detail['prefs']['target_track_id']}/cues", headers=auth_headers
    ).json()[0]
    client.post(
        f"/media/{media_id}/save-word",
        headers=auth_headers,
        json={
            "user_id": user_id, "word": "reticent", "cue_id": cue["id"], "cue_text": cue["text"],
            "start_ms": cue["start_ms"], "end_ms": cue["end_ms"], "definition": "Reserved.",
        },
    )
    clip_id = client.get(f"/media/clips/list?user_id={user_id}", headers=auth_headers).json()[0]["id"]
    video.unlink()

    retried = client.post(f"/media/clips/{clip_id}/retry?user_id={user_id}", headers=auth_headers)
    assert retried.status_code == 202
    failed = client.get(f"/media/clips/list?user_id={user_id}", headers=auth_headers).json()[0]
    assert failed["status"] == "failed"
    assert "relink" in (failed["error"] or "")


def test_the_clip_window_respects_the_learners_padding_settings(client, auth_headers, video):
    user_id, media_id = _import(client, auth_headers, video)
    client.put(
        f"/media/prefs/player?user_id={user_id}",
        headers=auth_headers,
        json={"clip_pad_before_ms": 200, "clip_pad_after_ms": 0},
    )
    detail = client.get(f"/media/{media_id}", headers=auth_headers).json()
    cue = client.get(
        f"/media/tracks/{detail['prefs']['target_track_id']}/cues", headers=auth_headers
    ).json()[1]

    res = client.post(
        f"/media/{media_id}/save-word",
        headers=auth_headers,
        json={
            "user_id": user_id, "word": "team", "cue_id": cue["id"], "cue_text": cue["text"],
            "start_ms": cue["start_ms"], "end_ms": cue["end_ms"], "definition": "A group.",
        },
    )
    clip = res.json()["clip"]
    assert clip["start_ms"] == cue["start_ms"] - 200
    assert clip["end_ms"] == cue["end_ms"]


def test_storage_summary_reports_what_is_actually_on_disk(client, auth_headers, video):
    user_id, media_id = _import(client, auth_headers, video)
    detail = client.get(f"/media/{media_id}", headers=auth_headers).json()
    cue = client.get(
        f"/media/tracks/{detail['prefs']['target_track_id']}/cues", headers=auth_headers
    ).json()[0]
    client.post(
        f"/media/{media_id}/save-word",
        headers=auth_headers,
        json={
            "user_id": user_id, "word": "reticent", "cue_id": cue["id"], "cue_text": cue["text"],
            "start_ms": cue["start_ms"], "end_ms": cue["end_ms"], "definition": "Reserved.",
        },
    )
    summary = client.get(f"/media/storage?user_id={user_id}", headers=auth_headers).json()
    assert summary["clips"] == 1
    assert summary["stored_clips"] == 1
    assert summary["clip_bytes"] > 0
    assert summary["ffmpeg_available"] is True
    assert summary["ffmpeg_version"]


def test_purging_clip_files_frees_disk_without_losing_saved_moments(client, auth_headers, video):
    """Spec §4.2's bulk cleanup. The learner's contexts are the valuable part;
    the video files are a cache and are treated as one."""
    user_id, media_id = _import(client, auth_headers, video)
    detail = client.get(f"/media/{media_id}", headers=auth_headers).json()
    cue = client.get(
        f"/media/tracks/{detail['prefs']['target_track_id']}/cues", headers=auth_headers
    ).json()[0]
    client.post(
        f"/media/{media_id}/save-word",
        headers=auth_headers,
        json={
            "user_id": user_id, "word": "reticent", "cue_id": cue["id"], "cue_text": cue["text"],
            "start_ms": cue["start_ms"], "end_ms": cue["end_ms"], "definition": "Reserved.",
        },
    )

    after = client.post(f"/media/clips/purge-files?user_id={user_id}", headers=auth_headers).json()
    assert after["stored_clips"] == 0
    assert after["clip_bytes"] == 0
    assert after["clips"] == 1

    word = client.get(f"/vocabulary/by-word/reticent?user_id={user_id}", headers=auth_headers).json()
    context = word["contexts"][0]
    assert context["snippet"] == cue["text"]
    assert context["clip_status"] == "virtual"

    # And it still plays — rebuilt from the source on demand.
    rebuilt = client.get(f"/media/clips/{context['clip_id']}/file?t=test-token")
    assert rebuilt.status_code == 200
    assert len(rebuilt.content) > 0


def test_a_word_saved_from_a_video_carries_its_cefr_level(client, auth_headers, video):
    """The end-to-end version of the save-time CEFR fix: the level has to
    survive the player's save path, not just save_manual_word's."""
    user_id, media_id = _import(client, auth_headers, video)
    detail = client.get(f"/media/{media_id}", headers=auth_headers).json()
    cue = client.get(
        f"/media/tracks/{detail['prefs']['target_track_id']}/cues", headers=auth_headers
    ).json()[0]

    client.post(
        f"/media/{media_id}/save-word",
        headers=auth_headers,
        json={
            "user_id": user_id, "word": "findings", "cue_id": cue["id"], "cue_text": cue["text"],
            "start_ms": cue["start_ms"], "end_ms": cue["end_ms"],
            "definition": "The results of an investigation.",
        },
    )
    word = client.get(f"/vocabulary/by-word/findings?user_id={user_id}", headers=auth_headers).json()
    assert word["cefr"] == "B1"


@pytest.fixture()
def slow_seek_mp4(tmp_path):
    """A plain MP4 — ffmpeg leaves the index at the end unless told otherwise."""
    dest = tmp_path / "Big.Film.2001.1080p.mp4"
    subprocess.run(
        [
            str(ffmpeg.ffmpeg_path()), "-hide_banner", "-loglevel", "error",
            "-f", "lavfi", "-i", "testsrc=size=240x135:rate=12:duration=5",
            "-f", "lavfi", "-i", "sine=frequency=300:duration=5",
            "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac",
            "-y", str(dest),
        ],
        check=True, capture_output=True,
    )
    return dest


def test_ingest_flags_a_file_whose_index_is_at_the_end(client, auth_headers, slow_seek_mp4):
    _user_id, media_id = _import(client, auth_headers, slow_seek_mp4)
    assert client.get(f"/media/{media_id}", headers=auth_headers).json()["item"]["index_at_end"] is True


def test_optimizing_moves_the_index_and_clears_the_flag(client, auth_headers, slow_seek_mp4):
    _user_id, media_id = _import(client, auth_headers, slow_seek_mp4)
    assert client.post(f"/media/{media_id}/optimize", headers=auth_headers).status_code == 202

    item = client.get(f"/media/{media_id}", headers=auth_headers).json()["item"]
    assert item["index_at_end"] is False
    assert item["ingest_error"] is None
    assert slow_seek_mp4.exists()


def test_optimizing_a_file_that_is_already_fine_is_refused(client, auth_headers, video):
    """The MKV fixture is never flagged, so this must not offer to rewrite it."""
    _user_id, media_id = _import(client, auth_headers, video)
    res = client.post(f"/media/{media_id}/optimize", headers=auth_headers)
    assert res.status_code == 409
    assert "already at the front" in res.json()["detail"]


def _reimport(client, auth_headers, user_id, video):
    res = client.post(
        "/media/import", headers=auth_headers, json={"user_id": user_id, "paths": [str(video)]}
    )
    assert res.status_code == 202
    return res.json()[0]["id"]


def _save_reticent(client, auth_headers, user_id, media_id):
    detail = client.get(f"/media/{media_id}", headers=auth_headers).json()
    cue = client.get(
        f"/media/tracks/{detail['prefs']['target_track_id']}/cues", headers=auth_headers
    ).json()[0]
    client.post(
        f"/media/{media_id}/save-word",
        headers=auth_headers,
        json={
            "user_id": user_id, "word": "reticent", "cue_id": cue["id"], "cue_text": cue["text"],
            "start_ms": cue["start_ms"], "end_ms": cue["end_ms"], "definition": "Reserved.",
        },
    )
    return cue


def _context(client, auth_headers, user_id):
    return client.get(
        f"/vocabulary/by-word/reticent?user_id={user_id}", headers=auth_headers
    ).json()["contexts"][0]


def test_removing_a_film_keeps_the_word_the_line_and_the_timecode(client, auth_headers, video):
    """Only what FluencyOS generated is thrown away. The captured moment is
    the learner's and survives losing the film it came from."""
    user_id, media_id = _import(client, auth_headers, video)
    cue = _save_reticent(client, auth_headers, user_id, media_id)
    client.delete(f"/media/{media_id}", headers=auth_headers)

    context = _context(client, auth_headers, user_id)
    assert context["snippet"] == cue["text"]
    assert context["start_ms"] == cue["start_ms"]
    assert context["source_label"].startswith("Arrival (2016)")
    # The clip itself is gone, and the card can tell because both are null.
    assert context["media_item_id"] is None
    assert context["clip_id"] is None
    assert video.exists()


def test_re_importing_the_same_film_reattaches_its_captured_moments(client, auth_headers, video):
    """The re-import gets a fresh id, so the context is matched on the file's
    own hash — which survives the round trip."""
    user_id, media_id = _import(client, auth_headers, video)
    _save_reticent(client, auth_headers, user_id, media_id)
    client.delete(f"/media/{media_id}", headers=auth_headers)
    assert _context(client, auth_headers, user_id)["media_item_id"] is None

    new_media_id = _reimport(client, auth_headers, user_id, video)
    assert new_media_id != media_id

    context = _context(client, auth_headers, user_id)
    assert context["media_item_id"] == new_media_id
    # Reattached as 'virtual': the extracted file went with the old entry, and
    # the source is back, so it is cut again only if it is actually played.
    assert context["clip_status"] == "virtual"


def test_a_reattached_moment_still_plays(client, auth_headers, video):
    user_id, media_id = _import(client, auth_headers, video)
    _save_reticent(client, auth_headers, user_id, media_id)
    client.delete(f"/media/{media_id}", headers=auth_headers)
    _reimport(client, auth_headers, user_id, video)

    clip_id = _context(client, auth_headers, user_id)["clip_id"]
    res = client.get(f"/media/clips/{clip_id}/file?t=test-token")
    assert res.status_code == 200
    assert len(res.content) > 0


def test_a_different_film_does_not_adopt_another_films_moments(client, auth_headers, video, tmp_path):
    """Relinking is on the file's hash, not on its title — importing something
    else must not hoover up orphaned contexts."""
    user_id, media_id = _import(client, auth_headers, video)
    _save_reticent(client, auth_headers, user_id, media_id)
    client.delete(f"/media/{media_id}", headers=auth_headers)

    other = tmp_path / "Different.Film.mkv"
    subprocess.run(
        [
            str(ffmpeg.ffmpeg_path()), "-hide_banner", "-loglevel", "error",
            "-f", "lavfi", "-i", "testsrc=size=240x135:rate=12:duration=4",
            "-c:v", "libx264", "-preset", "ultrafast", "-y", str(other),
        ],
        check=True, capture_output=True,
    )
    client.post("/media/import", headers=auth_headers, json={"user_id": user_id, "paths": [str(other)]})

    assert _context(client, auth_headers, user_id)["media_item_id"] is None


def test_moments_saved_before_the_hash_existed_are_stamped_at_startup(client, auth_headers, video):
    """Otherwise a moment captured before this change is unrecoverable the
    first time its film leaves the library."""
    from app.db import get_connection
    from app.services import vocabulary

    user_id, media_id = _import(client, auth_headers, video)
    _save_reticent(client, auth_headers, user_id, media_id)

    conn = get_connection()
    try:
        conn.execute("UPDATE vocab_contexts SET media_file_hash = NULL")
        conn.commit()
        assert vocabulary.backfill_context_hashes(conn) == 1
        stamped = conn.execute("SELECT media_file_hash FROM vocab_contexts").fetchone()[0]
        assert stamped == conn.execute(
            "SELECT file_hash FROM media_items WHERE id = ?", (media_id,)
        ).fetchone()[0]
    finally:
        conn.close()

    client.delete(f"/media/{media_id}", headers=auth_headers)
    new_media_id = _reimport(client, auth_headers, user_id, video)
    assert _context(client, auth_headers, user_id)["media_item_id"] == new_media_id


def test_another_learners_import_does_not_adopt_your_moments(client, auth_headers, video):
    """Two people can hold the same film; their captured moments are not
    interchangeable, so relinking is scoped to the owning learner."""
    user_id, media_id = _import(client, auth_headers, video)
    _save_reticent(client, auth_headers, user_id, media_id)
    client.delete(f"/media/{media_id}", headers=auth_headers)

    # A different learner imports the very same file.
    _other_id, _other_media = _import(client, auth_headers, video)

    assert _context(client, auth_headers, user_id)["media_item_id"] is None
