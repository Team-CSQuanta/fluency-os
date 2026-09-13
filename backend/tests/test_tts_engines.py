"""Choosing between the two voice engines (spec §6 voice channel).

Kokoro and Pocket TTS differ in a way that reaches beyond which model file
loads: Kokoro cannot emit anything until a whole chunk is synthesized, so
replies are split in two, while Pocket TTS streams from inside one call and
is not split at all. Everything here is about that difference being handled
consistently rather than assumed away — the real models are never loaded.
"""

import pytest

from app.config import settings
from app.db import get_connection
from app.migrations.runner import run_migrations
from app.services import conversation
from app.services.voice import model_catalog, pocket_tts_engine, tts, tts_engine


def _fresh_conn(tmp_path, name="tts_test.db"):
    settings.db_path = str(tmp_path / name)
    conn = get_connection()
    run_migrations(conn)
    return conn


def _make_user(conn, user_id="u1"):
    conn.execute(
        "INSERT INTO users (id, display_name, native_language, target_language, created_at) "
        "VALUES (?, 'Test User', 'en', 'en', '2026-01-01T00:00:00Z')",
        (user_id,),
    )
    conn.execute("INSERT INTO user_settings (user_id) VALUES (?)", (user_id,))
    conn.commit()
    return user_id


TWO_SENTENCES = "That sounds lovely. Where did you go afterwards?"


def test_new_users_default_to_pocket(tmp_path):
    """Pocket TTS is what the app speaks with — measured at 1.03s to first
    audio against Kokoro's 2.22s, and at ~0.53x real time where Kokoro drifts
    above 1.0x and starts leaving gaps in long replies."""
    conn = _fresh_conn(tmp_path)
    user_id = _make_user(conn)
    assert tts.selected_name(conn, user_id) == "pocket"


def test_the_migration_moves_existing_users_across(tmp_path):
    """Existing rows are switched too, not just the default for new ones —
    otherwise the app would speak differently depending on when the account
    was made."""
    conn = _fresh_conn(tmp_path, "migrated.db")
    user_id = _make_user(conn, "legacy-user")
    assert conn.execute(
        "SELECT tts_engine FROM user_settings WHERE user_id = ?", (user_id,)
    ).fetchone()["tts_engine"] == "pocket"


def test_unknown_engine_falls_back_rather_than_raising(tmp_path):
    """A downgrade or a hand-edited DB should still produce speech."""
    conn = _fresh_conn(tmp_path)
    user_id = _make_user(conn)
    conn.execute("UPDATE user_settings SET tts_engine = 'nonesuch' WHERE user_id = ?", (user_id,))
    conn.commit()
    assert tts.selected_name(conn, user_id) == "pocket"
    assert tts.engine_for("nonesuch") is pocket_tts_engine


def test_both_engines_split_a_two_sentence_reply():
    """Pocket TTS streams internally, which looks like a reason to skip the
    split — and isn't. ensure_audio_chunk writes a complete WAV and then
    serves the file, so the learner waits for all of chunk 0 whichever engine
    made it. Measured, one chunk per reply cost 2.05s to first audio against
    1.09s split, so the split earns its place on both."""
    assert tts_engine.split_for_streaming(TWO_SENTENCES) == [
        "That sounds lovely.",
        "Where did you go afterwards?",
    ]
    assert pocket_tts_engine.split_for_streaming(TWO_SENTENCES) == [
        "That sounds lovely.",
        "Where did you go afterwards?",
    ]


def test_a_one_word_opener_is_not_given_its_own_call():
    """Its fixed cost would exceed what splitting saves, and it would delay
    the remainder without meaningfully advancing the first sound."""
    assert tts_engine.split_for_streaming("Yes. I went there last summer.") == [
        "Yes. I went there last summer."
    ]


def test_a_single_sentence_is_not_split():
    assert tts_engine.split_for_streaming("Where did you go?") == ["Where did you go?"]
    assert tts_engine.split_for_streaming("   ") == []


def test_chunk_cache_is_per_engine(tmp_path, monkeypatch):
    """Both engines split the same way today, but the same file must not be
    reused across them regardless: the bytes are different voices, so a switch
    would keep replaying the old engine's audio forever. Keeping the engine in
    the name also means the split rule can diverge later without silently
    serving one engine's chunk 0 as the other's."""
    monkeypatch.setattr(settings, "db_path", str(tmp_path / "x.db"))
    monkeypatch.setattr(tts_engine, "synthesize", lambda text: b"kokoro:" + text.encode())
    monkeypatch.setattr(pocket_tts_engine, "synthesize", lambda text: b"pocket:" + text.encode())

    kokoro_path = conversation.ensure_audio_chunk("turn-1", TWO_SENTENCES, 0, "kokoro")
    pocket_path = conversation.ensure_audio_chunk("turn-1", TWO_SENTENCES, 0, "pocket")

    assert kokoro_path != pocket_path
    # Kokoro's chunk 0 is the opening sentence only; Pocket's is the lot.
    assert kokoro_path.read_bytes() == b"kokoro:That sounds lovely."
    assert pocket_path.read_bytes() == b"pocket:That sounds lovely."


def test_chunk_count_follows_the_selected_engine():
    turn = {"speaker": "ai", "text": TWO_SENTENCES}
    assert conversation.audio_chunk_count(turn, "voice", "kokoro") == 2
    assert conversation.audio_chunk_count(turn, "voice", "pocket") == 2
    # Neither engine speaks for the learner, or on the text channel.
    assert conversation.audio_chunk_count(turn, "text", "pocket") == 0
    assert conversation.audio_chunk_count({"speaker": "user", "text": "hi"}, "voice", "pocket") == 0


def test_readiness_asks_about_the_selected_engine_only(tmp_path, monkeypatch):
    """Having Kokoro on disk says nothing about whether Pocket TTS is. A
    session that would fail on the engine it will actually use should refuse
    up front, not at the first attempt to speak."""
    conn = _fresh_conn(tmp_path)
    user_id = _make_user(conn)
    monkeypatch.setattr(model_catalog, "llm_is_downloaded", lambda option: True)
    monkeypatch.setattr(model_catalog, "stt_is_downloaded", lambda: True)
    monkeypatch.setattr(model_catalog, "tts_is_downloaded", lambda: True)
    monkeypatch.setattr(model_catalog, "pocket_tts_is_downloaded", lambda: False)

    # Default engine is Pocket TTS, which is not downloaded here — having
    # Kokoro on disk must not make this read as ready.
    result = conversation.readiness(conn, user_id, "voice")
    assert result["tts"] is False
    assert result["ready"] is False

    conn.execute("UPDATE user_settings SET tts_engine = 'kokoro' WHERE user_id = ?", (user_id,))
    conn.commit()
    assert conversation.readiness(conn, user_id, "voice")["tts"] is True


def test_launch_warms_only_the_selected_engine(tmp_path, monkeypatch):
    """Warming the other one would hold a few hundred MB for a voice nothing
    is going to call."""
    conn = _fresh_conn(tmp_path)
    user_id = _make_user(conn)
    conn.execute("UPDATE user_settings SET tts_engine = 'pocket' WHERE user_id = ?", (user_id,))
    conn.commit()
    monkeypatch.setattr(model_catalog, "llm_is_downloaded", lambda option: True)
    monkeypatch.setattr(model_catalog, "stt_is_downloaded", lambda: False)
    monkeypatch.setattr(model_catalog, "tts_is_downloaded", lambda: True)
    monkeypatch.setattr(model_catalog, "pocket_tts_is_downloaded", lambda: True)

    warmed = []
    monkeypatch.setattr(conversation.llm_chat_engine, "warm_up", lambda repo_id, filename: warmed.append("llm"))
    monkeypatch.setattr(tts_engine, "warm_up", lambda: warmed.append("kokoro"))
    monkeypatch.setattr(pocket_tts_engine, "warm_up", lambda: warmed.append("pocket"))

    conversation.launch_engines(conn, user_id)
    assert "pocket" in warmed
    assert "kokoro" not in warmed


def test_unload_frees_both_engines(monkeypatch):
    """Whichever is resident is the one holding the memory, and after a
    switch that may not be the one currently selected."""
    freed = []
    monkeypatch.setattr(tts_engine, "unload", lambda: freed.append("kokoro"))
    monkeypatch.setattr(pocket_tts_engine, "unload", lambda: freed.append("pocket"))
    tts.unload_all()
    assert sorted(freed) == ["kokoro", "pocket"]


def test_pocket_engine_reports_a_clear_error_when_not_downloaded(tmp_path, monkeypatch):
    """The failure a learner is most likely to hit, so it must name the fix."""
    monkeypatch.setattr(settings, "db_path", str(tmp_path / "y.db"))
    pocket_tts_engine.unload()
    with pytest.raises(Exception) as err:
        pocket_tts_engine.warm_up()
    assert "download" in str(err.value).lower()


def test_pocket_engine_rejects_empty_text():
    with pytest.raises(Exception):
        pocket_tts_engine.synthesize("   ")


# --- routes -----------------------------------------------------------------

def _create_user(client, auth_headers):
    res = client.post(
        "/users",
        headers=auth_headers,
        json={"display_name": "Reader", "native_language": "en", "target_language": "en", "data_folder": "~/FluencyOS"},
    )
    assert res.status_code == 201
    return res.json()["id"]


def test_catalog_lists_both_voices_and_marks_the_selected_one(client, auth_headers):
    user_id = _create_user(client, auth_headers)
    body = client.get("/engine/models", headers=auth_headers, params={"user_id": user_id}).json()

    options = {o["key"]: o for o in body["tts_options"]}
    assert set(options) == {"kokoro", "pocket"}
    assert options["pocket"]["selected"] is True
    assert options["kokoro"]["selected"] is False
    # Default first: the list renders in order, so the engine the app actually
    # speaks with is the one at the top.
    assert [o["key"] for o in body["tts_options"]] == ["pocket", "kokoro"]
    # Both carry a real size, so the download is an informed choice.
    assert options["pocket"]["approx_size_mb"] > 0
    # The legacy single-voice field mirrors whichever is selected.
    assert body["tts"]["label"] == options["pocket"]["label"]


def test_selecting_an_engine_persists_and_is_reflected_in_the_catalog(client, auth_headers, monkeypatch):
    user_id = _create_user(client, auth_headers)
    monkeypatch.setattr(pocket_tts_engine, "is_installed", lambda: True)
    res = client.post(
        "/engine/models/tts-engine", headers=auth_headers, json={"user_id": user_id, "engine": "kokoro"}
    )
    assert res.status_code == 204

    body = client.get("/engine/models", headers=auth_headers, params={"user_id": user_id}).json()
    options = {o["key"]: o for o in body["tts_options"]}
    assert options["kokoro"]["selected"] is True
    assert options["pocket"]["selected"] is False
    assert body["tts"]["label"] == options["kokoro"]["label"]


def test_switching_engines_frees_the_outgoing_one(client, auth_headers, monkeypatch):
    """On a machine where Pocket TTS is the interesting option at all,
    holding both voices is what pushes it into swap."""
    user_id = _create_user(client, auth_headers)
    monkeypatch.setattr(pocket_tts_engine, "is_installed", lambda: True)
    freed = []
    monkeypatch.setattr(tts_engine, "unload", lambda: freed.append("kokoro"))
    monkeypatch.setattr(pocket_tts_engine, "unload", lambda: freed.append("pocket"))

    client.post(
        "/engine/models/tts-engine", headers=auth_headers, json={"user_id": user_id, "engine": "pocket"}
    )
    assert sorted(freed) == ["kokoro", "pocket"]


def test_selecting_pocket_without_its_runtime_is_refused_with_the_fix(client, auth_headers, monkeypatch):
    """Pocket TTS sits behind an optional extra, so it can be listed on a
    machine that cannot run it. Letting the setting apply anyway would leave a
    learner with a voice that looks selected and a conversation that is
    silent — so the refusal has to name the command that fixes it."""
    user_id = _create_user(client, auth_headers)
    client.post(
        "/engine/models/tts-engine", headers=auth_headers, json={"user_id": user_id, "engine": "kokoro"}
    )
    monkeypatch.setattr(pocket_tts_engine, "is_installed", lambda: False)

    res = client.post(
        "/engine/models/tts-engine", headers=auth_headers, json={"user_id": user_id, "engine": "pocket"}
    )
    assert res.status_code == 400
    assert "pocket" in res.json()["detail"].lower()


def test_catalog_reports_whether_the_pocket_runtime_is_installed(client, auth_headers, monkeypatch):
    user_id = _create_user(client, auth_headers)
    monkeypatch.setattr(pocket_tts_engine, "is_installed", lambda: False)
    body = client.get("/engine/models", headers=auth_headers, params={"user_id": user_id}).json()
    options = {o["key"]: o for o in body["tts_options"]}
    assert options["pocket"]["installed"] is False
    # Kokoro's runtime is a required dependency, so it is always present.
    assert options["kokoro"]["installed"] is True


def test_selecting_an_unknown_engine_is_rejected(client, auth_headers):
    user_id = _create_user(client, auth_headers)
    res = client.post(
        "/engine/models/tts-engine", headers=auth_headers, json={"user_id": user_id, "engine": "espeak"}
    )
    assert res.status_code == 422


def test_deleting_pocket_tts_that_isnt_downloaded_is_a_404(client, auth_headers):
    res = client.delete("/engine/models/pocket-tts", headers=auth_headers)
    assert res.status_code == 404


def test_pocket_tts_download_route_starts_a_download(client, auth_headers, monkeypatch):
    from app.services.voice import download_manager

    started = []
    monkeypatch.setattr(download_manager, "start_download", lambda kind, key: started.append((kind, key)))
    res = client.post("/engine/models/pocket-tts/download", headers=auth_headers)
    assert res.status_code == 200
    assert started == [("pocket_tts", "")]


def test_loaded_kokoro_does_not_make_pocket_read_as_launched(monkeypatch):
    """The two questions this status answers are different, and conflating
    them costs a silent model load in the middle of a conversation.

    "Is a voice occupying RAM?" — what the global AI indicator asks, and true
    whenever either engine is resident. "Is the voice I am about to speak with
    loaded?" — what the turn path asks, and false here."""
    from app.services.voice import engine_status

    monkeypatch.setattr(tts_engine, "is_ready", lambda: True)
    monkeypatch.setattr(pocket_tts_engine, "is_ready", lambda: False)

    # No engine named: reports what is holding memory.
    assert engine_status.status()["tts"] == "ready"
    # Engine named: reports that specific one.
    assert engine_status.status(None, "kokoro")["tts"] == "ready"
    assert engine_status.status(None, "pocket")["tts"] == "not_loaded"


def test_starting_a_session_refuses_when_the_selected_voice_isnt_loaded(tmp_path, monkeypatch):
    """Follows from the above: selecting Pocket TTS while Kokoro is the engine
    actually in memory must send the learner to Launch AI, not stall the first
    turn on a multi-second load."""
    conn = _fresh_conn(tmp_path, "launchcheck.db")
    user_id = _make_user(conn)
    conn.execute("UPDATE user_settings SET tts_engine = 'pocket' WHERE user_id = ?", (user_id,))
    conn.commit()
    monkeypatch.setattr(model_catalog, "llm_is_downloaded", lambda option: True)
    monkeypatch.setattr(model_catalog, "stt_is_downloaded", lambda: True)
    monkeypatch.setattr(model_catalog, "pocket_tts_is_downloaded", lambda: True)
    monkeypatch.setattr(tts_engine, "is_ready", lambda: True)
    monkeypatch.setattr(pocket_tts_engine, "is_ready", lambda: False)
    monkeypatch.setattr(conversation.llm_chat_engine, "is_ready_for", lambda path: True)

    with pytest.raises(Exception) as err:
        conversation.start_session(conn, user_id=user_id, scenario="cafe", channel="voice")
    assert "TTS" in str(err.value)


# --- downloads --------------------------------------------------------------

def test_a_truncated_download_is_rejected_rather_than_left_in_place(tmp_path, monkeypatch):
    """A dropped connection ends the read loop exactly like a finished one.
    Without a size check the short file is renamed into place, every
    is_downloaded() check (which only tests existence) reports success, and
    the failure resurfaces much later as an unintelligible parse error from
    whichever library tries to load half a model."""
    import io
    import urllib.request

    from app.services.voice import download_manager

    class _Truncated(io.BytesIO):
        headers = {"Content-Length": "1000"}

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    monkeypatch.setattr(urllib.request, "urlopen", lambda *a, **kw: _Truncated(b"x" * 400))

    dest = tmp_path / "model.safetensors"
    state = download_manager.DownloadState()
    with pytest.raises(OSError) as err:
        download_manager._stream_to_file("https://example.invalid/m", dest, state)

    assert "incompletely" in str(err.value)
    # Neither the half file nor its .part survives, so nothing downstream can
    # mistake either for a usable model.
    assert not dest.exists()
    assert not dest.with_suffix(".safetensors.part").exists()
    # ...and the progress it had already claimed is given back.
    assert state.downloaded_bytes == 0


def test_a_complete_download_is_accepted(tmp_path, monkeypatch):
    import io
    import urllib.request

    from app.services.voice import download_manager

    class _Complete(io.BytesIO):
        headers = {"Content-Length": "400"}

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    monkeypatch.setattr(urllib.request, "urlopen", lambda *a, **kw: _Complete(b"x" * 400))

    dest = tmp_path / "model.safetensors"
    state = download_manager.DownloadState()
    download_manager._stream_to_file("https://example.invalid/m", dest, state)
    assert dest.read_bytes() == b"x" * 400
    assert state.downloaded_bytes == 400


def test_a_chunk_is_never_served_while_it_is_still_being_written(tmp_path, monkeypatch):
    """The player fetches chunk N+1 while N is still audible, so two requests
    for the same chunk really can overlap. Writing straight to the served path
    let a FileResponse read a half-written WAV, which plays as a click or as
    silence. The bytes must appear at the final path all at once."""
    monkeypatch.setattr(settings, "db_path", str(tmp_path / "atomic.db"))
    seen: list[bool] = []

    def _slow_synthesize(text: str) -> bytes:
        # Whatever a concurrent reader would see mid-synthesis.
        target = conversation.audio_chunk_path("turn-x", 0, "kokoro")
        seen.append(target.exists())
        return b"RIFFcomplete-audio"

    monkeypatch.setattr(tts_engine, "synthesize", _slow_synthesize)
    path = conversation.ensure_audio_chunk("turn-x", "One sentence only.", 0, "kokoro")

    assert seen == [False], "the final path must not exist until the bytes are complete"
    assert path.read_bytes() == b"RIFFcomplete-audio"
    # No .part debris left next to it.
    assert not list(path.parent.glob("*.part"))


def test_a_failed_synthesis_leaves_no_partial_file(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "db_path", str(tmp_path / "atomic2.db"))

    def _boom(text: str) -> bytes:
        raise RuntimeError("engine died")

    monkeypatch.setattr(tts_engine, "synthesize", _boom)
    with pytest.raises(RuntimeError):
        conversation.ensure_audio_chunk("turn-y", "One sentence only.", 0, "kokoro")

    assert not conversation.audio_chunk_path("turn-y", 0, "kokoro").exists()
    assert not list(conversation.audio_chunk_path("turn-y", 0, "kokoro").parent.glob("*.part"))
