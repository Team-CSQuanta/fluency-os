"""Choosing the voice replies are spoken in.

The engine choice (test_tts_engines.py) decides which model speaks; this is
about which of its voices. The parts worth pinning down are the ones that
would fail quietly: a cached reply replayed in the old voice, a picked voice
that is still downloading leaving the app silent, and a British voice read
with American phonemes. The real models are never loaded.
"""

import pytest

from app.config import settings
from app.db import get_connection
from app.migrations.runner import run_migrations
from app.services import conversation, vocabulary
from app.services.voice import download_manager, model_manager, pocket_tts_engine, tts, tts_engine, voices
from app.services.voice.errors import EngineUnavailable

TWO_SENTENCES = "That sounds lovely. Where did you go afterwards?"


def _fresh_conn(tmp_path):
    settings.db_path = str(tmp_path / "voices.db")
    conn = get_connection()
    run_migrations(conn)
    conn.execute(
        "INSERT INTO users (id, display_name, native_language, target_language, created_at) "
        "VALUES ('u1', 'Test User', 'en', 'en', '2026-01-01T00:00:00Z')"
    )
    conn.execute("INSERT INTO user_settings (user_id) VALUES ('u1')")
    conn.commit()
    return conn


def _put_pocket_voice_on_disk(voice: str) -> None:
    path = model_manager.pocket_voice_path(voice)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"embedding")


# --- catalog ----------------------------------------------------------------


@pytest.mark.parametrize("engine", ["kokoro", "pocket"])
def test_every_engine_offers_both_female_and_male_voices(engine):
    genders = {v.gender for v in voices.CATALOG[engine]}
    assert genders == {"female", "male"}


@pytest.mark.parametrize("engine", ["kokoro", "pocket"])
def test_voice_keys_are_unique_and_the_default_is_listed(engine):
    keys = [v.key for v in voices.CATALOG[engine]]
    assert len(keys) == len(set(keys))
    assert voices.DEFAULT[engine] in keys


def test_kokoro_voice_names_agree_with_their_gender():
    """Kokoro encodes gender in the key (af_/bf_ female, am_/bm_ male) — the
    label shown to the learner must not contradict it."""
    for v in voices.KOKORO_VOICES:
        assert v.gender == ("female" if v.key[1] == "f" else "male"), v.key


def test_voice_keys_are_safe_in_a_cache_filename():
    """They become one dot-separated segment of every audio file's name, and
    the cleanup globs rely on that segment containing no dots."""
    for engine in ("kokoro", "pocket"):
        for v in voices.CATALOG[engine]:
            assert v.key.replace("_", "").isalnum(), v.key


# --- selection ----------------------------------------------------------------


def test_new_users_keep_the_voices_they_had_before(tmp_path):
    conn = _fresh_conn(tmp_path)
    assert tts.chosen_voice(conn, "u1", "pocket") == "alba"
    assert tts.chosen_voice(conn, "u1", "kokoro") == "af_heart"


def test_each_engine_remembers_its_own_voice(tmp_path):
    """Switching engines and back must not lose the voice picked for either."""
    conn = _fresh_conn(tmp_path)
    tts.set_voice(conn, "u1", "pocket", "eve")
    tts.set_voice(conn, "u1", "kokoro", "bf_emma")
    assert tts.chosen_voice(conn, "u1", "pocket") == "eve"
    assert tts.chosen_voice(conn, "u1", "kokoro") == "bf_emma"


def test_an_unknown_voice_is_refused(tmp_path):
    conn = _fresh_conn(tmp_path)
    with pytest.raises(ValueError):
        tts.set_voice(conn, "u1", "pocket", "af_heart")  # a Kokoro voice


def test_an_unknown_stored_voice_speaks_in_the_default(tmp_path):
    """A downgrade or a hand-edited DB should still produce speech."""
    conn = _fresh_conn(tmp_path)
    conn.execute("UPDATE user_settings SET tts_pocket_voice = 'nonesuch' WHERE user_id = 'u1'")
    assert tts.chosen_voice(conn, "u1", "pocket") == "alba"


def test_a_pocket_voice_still_downloading_speaks_in_the_default(tmp_path):
    """Choosing a voice must never leave replies silent while its file is on
    its way — they carry on in the default until it lands."""
    conn = _fresh_conn(tmp_path)
    tts.set_voice(conn, "u1", "pocket", "eve")
    assert tts.chosen_voice(conn, "u1", "pocket") == "eve"
    assert tts.selected_voice(conn, "u1", "pocket") == "alba"

    _put_pocket_voice_on_disk("eve")
    assert tts.selected_voice(conn, "u1", "pocket") == "eve"


def test_selected_voice_follows_the_selected_engine(tmp_path, monkeypatch):
    conn = _fresh_conn(tmp_path)
    monkeypatch.setattr(voices.model_catalog, "tts_is_downloaded", lambda: True)
    tts.set_voice(conn, "u1", "kokoro", "am_michael")
    conn.execute("UPDATE user_settings SET tts_engine = 'kokoro' WHERE user_id = 'u1'")
    assert tts.selected_voice(conn, "u1") == "am_michael"


# --- audio caches ---------------------------------------------------------------


def test_conversation_audio_is_cached_per_voice(tmp_path, monkeypatch):
    """Otherwise a reply already heard in one voice would keep replaying in it
    after the learner picked another."""
    monkeypatch.setattr(settings, "db_path", str(tmp_path / "x.db"))
    spoken: list[tuple[str, str | None]] = []

    def fake(text, voice=None):
        spoken.append((text, voice))
        return f"{voice}:{text}".encode()

    monkeypatch.setattr(pocket_tts_engine, "synthesize", fake)
    alba = conversation.ensure_audio_chunk("turn-1", TWO_SENTENCES, 0, "pocket", "alba")
    eve = conversation.ensure_audio_chunk("turn-1", TWO_SENTENCES, 0, "pocket", "eve")

    assert alba != eve
    assert alba.read_bytes() == b"alba:That sounds lovely."
    assert eve.read_bytes() == b"eve:That sounds lovely."
    # Cached: asking again does not synthesize again.
    conversation.ensure_audio_chunk("turn-1", TWO_SENTENCES, 0, "pocket", "eve")
    assert len(spoken) == 2


def test_turn_cleanup_still_finds_audio_in_every_voice(tmp_path, monkeypatch):
    """The cleanup glob is `{turn_id}.*.wav`; the voice segment must not put
    files out of its reach."""
    monkeypatch.setattr(settings, "db_path", str(tmp_path / "x.db"))
    monkeypatch.setattr(pocket_tts_engine, "synthesize", lambda text, voice=None: b"wav")
    path = conversation.ensure_audio_chunk("turn-9", TWO_SENTENCES, 1, "pocket", "jane")
    assert path in list(path.parent.glob("turn-9.*.wav"))


def test_pronunciation_and_speech_are_cached_per_voice(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "db_path", str(tmp_path / "x.db"))
    monkeypatch.setattr(tts_engine, "synthesize", lambda text, voice=None: f"{voice}".encode())

    a = vocabulary.pronunciation_path("w1", "harbour", "word", "kokoro", "af_heart")
    b = vocabulary.pronunciation_path("w1", "harbour", "word", "kokoro", "bm_george")
    assert a != b and b.read_bytes() == b"bm_george"

    c = vocabulary.speech_path("the harbour", "kokoro", "af_heart")
    d = vocabulary.speech_path("the harbour", "kokoro", "bf_emma")
    assert c != d and d.read_bytes() == b"bf_emma"

    # Removing the word removes its clips in every voice.
    vocabulary.delete_pronunciation("w1")
    assert not a.exists() and not b.exists()


# --- engines --------------------------------------------------------------------


class _FakeKokoro:
    def __init__(self):
        self.calls = []

    def create(self, text, voice, speed, lang):
        import numpy as np

        self.calls.append((voice, lang))
        return np.zeros(10, dtype="float32"), 24000


def test_kokoro_reads_british_voices_with_british_phonemes(monkeypatch):
    fake = _FakeKokoro()
    monkeypatch.setattr(tts_engine, "_load_kokoro_locked", lambda: fake)
    tts_engine.synthesize("Hello", voice="bf_emma")
    tts_engine.synthesize("Hello", voice="am_michael")
    tts_engine.synthesize("Hello")
    assert fake.calls == [("bf_emma", "en-gb"), ("am_michael", "en-us"), ("af_heart", "en-us")]


class _FakePocketModel:
    def __init__(self):
        self.loaded = []

    def get_state_for_audio_prompt(self, path):
        self.loaded.append(path)
        return {"voice": path}


def test_pocket_keeps_a_few_voices_loaded_and_no_more(tmp_path, monkeypatch):
    """Auditioning every voice in Settings must not pin all of them in
    memory, but going back and forth between two must not re-read them."""
    monkeypatch.setattr(settings, "db_path", str(tmp_path / "x.db"))
    monkeypatch.setattr(pocket_tts_engine, "_voice_states", {})
    model = _FakePocketModel()
    for voice in ("eve", "jane", "mary", "anna"):
        _put_pocket_voice_on_disk(voice)

    with pocket_tts_engine._lock:
        for voice in ("eve", "jane", "eve", "mary", "anna"):
            pocket_tts_engine._voice_state_locked(model, voice)

    assert len(model.loaded) == 4  # the second "eve" came from the cache
    assert len(pocket_tts_engine._voice_states) == pocket_tts_engine._MAX_VOICE_STATES


def test_pocket_says_so_when_a_voice_is_not_on_disk(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "db_path", str(tmp_path / "x.db"))
    monkeypatch.setattr(pocket_tts_engine, "_voice_states", {})
    with pytest.raises(EngineUnavailable, match="hasn't been downloaded"):
        with pocket_tts_engine._lock:
            pocket_tts_engine._voice_state_locked(_FakePocketModel(), "vera")


def test_each_pocket_voice_has_its_own_download_key():
    assert download_manager.download_key("pocket_voice", "eve") != download_manager.download_key(
        "pocket_voice", "jane"
    )


# --- API ------------------------------------------------------------------------


def _create_user(client, auth_headers):
    res = client.post(
        "/users",
        headers=auth_headers,
        json={"display_name": "Reader", "native_language": "en", "target_language": "en", "data_folder": "~/FluencyOS"},
    )
    assert res.status_code == 201
    return res.json()["id"]


def test_voice_list_shows_the_selected_engines_voices(client, auth_headers):
    user_id = _create_user(client, auth_headers)
    body = client.get("/engine/voices", headers=auth_headers, params={"user_id": user_id}).json()
    assert body["engine"] == "pocket"
    assert body["chosen"] == "alba" and body["speaking"] == "alba"
    keys = {v["key"] for v in body["voices"]}
    assert {"eve", "jane", "alba", "george"} <= keys
    assert {v["gender"] for v in body["voices"]} == {"female", "male"}

    kokoro = client.get(
        "/engine/voices", headers=auth_headers, params={"user_id": user_id, "engine": "kokoro"}
    ).json()
    assert kokoro["chosen"] == "af_heart"


def test_choosing_a_pocket_voice_downloads_it_and_keeps_speaking_meanwhile(client, auth_headers, monkeypatch):
    user_id = _create_user(client, auth_headers)
    started = []
    monkeypatch.setattr(download_manager, "start_download", lambda kind, key: started.append((kind, key)))

    res = client.put(
        "/engine/voices", headers=auth_headers, json={"user_id": user_id, "engine": "pocket", "voice": "eve"}
    )
    assert res.status_code == 200
    body = res.json()
    assert started == [("pocket_voice", "eve")]
    assert body["chosen"] == "eve"
    assert body["speaking"] == "alba"  # until the file lands


def test_choosing_an_unknown_voice_is_a_400(client, auth_headers):
    user_id = _create_user(client, auth_headers)
    res = client.put(
        "/engine/voices", headers=auth_headers, json={"user_id": user_id, "engine": "pocket", "voice": "nope"}
    )
    assert res.status_code == 400


def test_preview_needs_the_engine_downloaded(client, auth_headers):
    res = client.get("/engine/voices/preview", headers=auth_headers, params={"engine": "kokoro", "voice": "af_bella"})
    assert res.status_code == 503
    assert "AI settings" in res.json()["detail"]


def test_preview_is_synthesized_once_in_the_asked_for_voice(client, auth_headers, monkeypatch):
    calls = []
    monkeypatch.setattr(tts, "is_downloaded", lambda name: True)
    monkeypatch.setattr(
        tts_engine, "synthesize", lambda text, voice=None: calls.append((text, voice)) or b"RIFFpreview"
    )
    for _ in range(2):
        res = client.get(
            "/engine/voices/preview", headers=auth_headers, params={"engine": "kokoro", "voice": "bf_isabella"}
        )
        assert res.status_code == 200
        assert res.content == b"RIFFpreview"
    assert len(calls) == 1
    assert calls[0][1] == "bf_isabella" and "Isabella" in calls[0][0]


def test_previewing_a_pocket_voice_fetches_it_first(client, auth_headers, monkeypatch):
    monkeypatch.setattr(tts, "is_downloaded", lambda name: True)
    fetched = []

    def fake_fetch(voice):
        fetched.append(voice)
        _put_pocket_voice_on_disk(voice)

    monkeypatch.setattr(download_manager, "download_pocket_voice_now", fake_fetch)
    monkeypatch.setattr(pocket_tts_engine, "synthesize", lambda text, voice=None: b"RIFF" + voice.encode())
    res = client.get("/engine/voices/preview", headers=auth_headers, params={"engine": "pocket", "voice": "mary"})
    assert res.status_code == 200
    assert fetched == ["mary"]
    assert res.content == b"RIFFmary"
