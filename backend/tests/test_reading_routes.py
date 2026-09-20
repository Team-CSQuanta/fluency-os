"""/reading route tests (spec Phase 6): heat and offline word lookup."""


def _create_user(client, auth_headers, cefr_level=None):
    res = client.post(
        "/users",
        headers=auth_headers,
        json={
            "display_name": "Reader",
            "native_language": "en",
            "target_language": "en",
            "data_folder": "~/FluencyOS",
        },
    )
    assert res.status_code == 201
    user_id = res.json()["id"]
    if cefr_level:
        patched = client.patch(
            f"/users/{user_id}/placement", headers=auth_headers, json={"cefr_level": cefr_level}
        )
        assert patched.status_code == 200
    return user_id


def _import_book(client, auth_headers, tmp_path, user_id, text, *, heat_overlay=True):
    source = tmp_path / "Heat Sample.txt"
    source.write_text(text, encoding="utf-8")
    res = client.post(
        "/books/import",
        headers=auth_headers,
        json={
            "user_id": user_id,
            "paths": [str(source)],
            "heat_overlay": heat_overlay,
        },
    )
    assert res.status_code == 202
    return res.json()[0]["id"]


SAMPLE = "She was reticent about the findings.\n\nThe man went to the shop for food."


def test_heat_requires_token(client):
    res = client.get("/reading/heat", params={"book_id": "x"})
    assert res.status_code == 401


def test_lookup_requires_token(client):
    res = client.get("/reading/lookup", params={"w": "reticent"})
    assert res.status_code == 401


def test_heat_marks_above_level_words(client, auth_headers, tmp_path):
    user_id = _create_user(client, auth_headers)
    book_id = _import_book(client, auth_headers, tmp_path, user_id, SAMPLE)

    res = client.get(
        "/reading/heat", headers=auth_headers, params={"book_id": book_id, "target_cefr": "B1"}
    )
    assert res.status_code == 200
    body = res.json()

    assert body["enabled"] is True
    assert body["target_cefr"] == "B1"
    assert body["total_above_level"] == 1
    assert len(body["blocks"]) == 2

    first = body["blocks"][0]
    assert first["spans"][0]["word"] == "reticent"
    assert first["spans"][0]["cefr"] == "C1"
    # The easy second paragraph is still returned, just with no spans.
    assert body["blocks"][1]["spans"] == []


def test_heat_uses_the_readers_own_level_by_default(client, auth_headers, tmp_path):
    user_id = _create_user(client, auth_headers, cefr_level="C1")
    book_id = _import_book(client, auth_headers, tmp_path, user_id, SAMPLE)

    res = client.get(
        "/reading/heat", headers=auth_headers, params={"book_id": book_id, "user_id": user_id}
    )
    body = res.json()

    # "reticent" is C1, so it is not above a C1 reader.
    assert body["target_cefr"] == "C1"
    assert body["total_above_level"] == 0


def test_heat_respects_the_per_book_overlay_flag(client, auth_headers, tmp_path):
    user_id = _create_user(client, auth_headers)
    book_id = _import_book(client, auth_headers, tmp_path, user_id, SAMPLE, heat_overlay=False)

    res = client.get(
        "/reading/heat", headers=auth_headers, params={"book_id": book_id, "target_cefr": "B1"}
    )
    body = res.json()

    assert body["enabled"] is False
    assert body["blocks"] == []
    assert body["total_above_level"] == 0


def test_heat_windows_match_the_block_window(client, auth_headers, tmp_path):
    user_id = _create_user(client, auth_headers)
    book_id = _import_book(client, auth_headers, tmp_path, user_id, SAMPLE)

    res = client.get(
        "/reading/heat",
        headers=auth_headers,
        params={"book_id": book_id, "from_index": 1, "limit": 1, "target_cefr": "B1"},
    )
    body = res.json()

    assert [b["block_index"] for b in body["blocks"]] == [1]


def test_heat_rejects_an_invalid_band(client, auth_headers, tmp_path):
    user_id = _create_user(client, auth_headers)
    book_id = _import_book(client, auth_headers, tmp_path, user_id, SAMPLE)

    res = client.get(
        "/reading/heat", headers=auth_headers, params={"book_id": book_id, "target_cefr": "D9"}
    )

    assert res.status_code == 400


def test_heat_404s_for_an_unknown_book(client, auth_headers):
    res = client.get("/reading/heat", headers=auth_headers, params={"book_id": "nope"})
    assert res.status_code == 404


def test_lookup_returns_a_real_definition_with_no_model(client, auth_headers):
    res = client.get("/reading/lookup", headers=auth_headers, params={"w": "reticent"})
    assert res.status_code == 200
    body = res.json()

    assert body["found"] is True
    assert body["lemma"] == "reticent"
    assert body["cefr"] == "C1"
    assert body["pos"] == "adjective"
    assert body["senses"][0]["definition"]
    assert "reserved" in body["synonyms"]
    # Explaining the word in its sentence needs generation — never faked.
    assert body["context_available"] is False


def test_lookup_resolves_an_inflected_form(client, auth_headers):
    res = client.get("/reading/lookup", headers=auth_headers, params={"w": "ossified"})
    body = res.json()

    assert body["found"] is True
    assert body["lemma"] == "ossify"


def _offline(monkeypatch):
    """No test may reach the real internet. Patches the transport the whole
    lookup ladder ends at, so the local layers run for real and the network
    layer answers however the test wants."""
    from app.services import dictionary_lookup as transport

    def _set(fn):
        monkeypatch.setattr(transport, "search", fn)

    return _set


def test_lookup_reports_an_unknown_word_honestly(client, auth_headers, monkeypatch):
    from app.services.dictionary_lookup import DictionaryResult

    _offline(monkeypatch)(
        lambda word, timeout=None: DictionaryResult(
            word=word, found=False, ipa=None, audio_url=None, senses=(), synonyms=()
        )
    )

    res = client.get("/reading/lookup", headers=auth_headers, params={"w": "zzzxqv"})
    body = res.json()

    assert body["found"] is False
    assert body["senses"] == []
    assert body["cefr"] is None


def test_lookup_falls_back_to_the_online_dictionary(client, auth_headers, monkeypatch):
    """The reader used to consult the bundled list alone, which defines a few
    hundred words — so nearly every word in a real novel came back unknown
    while an answer was a second away."""
    from app.services.dictionary_lookup import DictionaryResult, DictionarySense

    _offline(monkeypatch)(
        lambda word, timeout=None: DictionaryResult(
            word=word,
            found=True,
            ipa=None,
            audio_url=None,
            senses=(DictionarySense(pos="verb", definition="To do away with.", example=None),),
            synonyms=("scrap",),
        )
    )

    body = client.get("/reading/lookup", headers=auth_headers, params={"w": "abolish"}).json()

    assert body["found"] is True
    assert body["senses"][0]["definition"] == "To do away with."
    # Still ours, because no online dictionary carries a CEFR band.
    assert body["cefr"] == "B2"


def test_lookup_prefers_the_bundled_lexicon_over_the_network(client, auth_headers, monkeypatch):
    def _explode(word, timeout=None):
        raise AssertionError(f"went online for {word!r}, which the lexicon knows")

    _offline(monkeypatch)(_explode)

    body = client.get("/reading/lookup", headers=auth_headers, params={"w": "reticent"}).json()

    assert body["found"] is True
    assert body["lemma"] == "reticent"


def test_lookup_survives_the_dictionary_being_unreachable(client, auth_headers, monkeypatch):
    """Reading is an offline activity. A dictionary that cannot be reached
    must not turn clicking a word into an error."""
    from app.services.dictionary_lookup import DictionaryServiceUnavailable

    def _down(word, timeout=None):
        raise DictionaryServiceUnavailable("no network")

    _offline(monkeypatch)(_down)

    res = client.get("/reading/lookup", headers=auth_headers, params={"w": "abolish"})

    assert res.status_code == 200
    assert res.json()["found"] is False
    # The band table is local, so it still knows how hard the word is.
    assert res.json()["cefr"] == "B2"


def test_lookup_rejects_an_empty_word(client, auth_headers):
    res = client.get("/reading/lookup", headers=auth_headers, params={"w": "   "})
    assert res.status_code == 400
