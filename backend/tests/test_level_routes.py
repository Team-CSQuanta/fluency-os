"""POST /reading/level and the session routes (spec Phase 7)."""

SAMPLE = (
    "She was reticent about the findings.\n\n"
    "They had to put up with the noise for a long time."
)


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
        assert (
            client.patch(
                f"/users/{user_id}/placement", headers=auth_headers, json={"cefr_level": cefr_level}
            ).status_code
            == 200
        )
    return user_id


def _import_book(client, auth_headers, tmp_path, user_id):
    source = tmp_path / "Level Sample.txt"
    source.write_text(SAMPLE, encoding="utf-8")
    res = client.post(
        "/books/import", headers=auth_headers, json={"user_id": user_id, "paths": [str(source)]}
    )
    assert res.status_code == 202
    return res.json()[0]["id"]


def _level(client, auth_headers, book_id, mode, block_index=0, **extra):
    res = client.post(
        "/reading/level",
        headers=auth_headers,
        json={"book_id": book_id, "block_index": block_index, "mode": mode, **extra},
    )
    assert res.status_code == 200, res.text
    return res.json()


def test_level_requires_token(client):
    res = client.post("/reading/level", json={"book_id": "x", "block_index": 0, "mode": "inline"})
    assert res.status_code == 401


def test_inline_mode_returns_segments_and_a_ledger(client, auth_headers, tmp_path):
    user_id = _create_user(client, auth_headers)
    book_id = _import_book(client, auth_headers, tmp_path, user_id)

    body = _level(client, auth_headers, book_id, "inline", target_cefr="A2")

    assert body["available"] is True
    assert body["served_mode"] == "inline"
    assert body["engine"] == "rules-v1"
    assert "".join(s["text"] for s in body["segments"]) != ""
    assert body["substitutions"]
    assert set(body["substitutions"][0]) == {"from_text", "to_text"}


def test_second_identical_request_is_served_from_cache(client, auth_headers, tmp_path):
    user_id = _create_user(client, auth_headers)
    book_id = _import_book(client, auth_headers, tmp_path, user_id)

    first = _level(client, auth_headers, book_id, "inline", target_cefr="A2")
    second = _level(client, auth_headers, book_id, "inline", target_cefr="A2")

    assert first["cached"] is False
    assert second["cached"] is True
    # A cache hit must be byte-identical, not merely equivalent.
    assert first["segments"] == second["segments"]
    assert first["original"] == second["original"]


def test_cache_is_keyed_by_target_level(client, auth_headers, tmp_path):
    user_id = _create_user(client, auth_headers)
    book_id = _import_book(client, auth_headers, tmp_path, user_id)

    _level(client, auth_headers, book_id, "inline", target_cefr="A2")
    other = _level(client, auth_headers, book_id, "inline", target_cefr="C2")

    assert other["cached"] is False


def test_lexical_mode_expands_a_phrase(client, auth_headers, tmp_path):
    user_id = _create_user(client, auth_headers)
    book_id = _import_book(client, auth_headers, tmp_path, user_id)

    body = _level(client, auth_headers, book_id, "lexical", block_index=1, target_cefr="B1")

    text = "".join(s["text"] for s in body["segments"])
    assert "put up with" not in text


def test_contextual_degrades_to_inline_with_a_visible_note(client, auth_headers, tmp_path):
    """No model is configured, so the panel must be told what it actually got."""
    user_id = _create_user(client, auth_headers)
    book_id = _import_book(client, auth_headers, tmp_path, user_id)

    body = _level(client, auth_headers, book_id, "contextual", target_cefr="A2")

    assert body["mode"] == "contextual"
    assert body["served_mode"] == "inline"
    assert body["available"] is False
    assert body["note"] and "inline" in body["note"].lower()
    assert body["segments"]


def test_semantic_is_gated_with_no_invented_content(client, auth_headers, tmp_path):
    user_id = _create_user(client, auth_headers)
    book_id = _import_book(client, auth_headers, tmp_path, user_id)

    body = _level(client, auth_headers, book_id, "semantic", target_cefr="A2")

    assert body["available"] is False
    assert body["segments"] == []
    assert body["note"]
    # The original is still returned so the panel can show the source text.
    assert body["original"]


def test_unavailable_result_is_not_cached(client, auth_headers, tmp_path):
    """Otherwise configuring a model later would have to invalidate the cache."""
    user_id = _create_user(client, auth_headers)
    book_id = _import_book(client, auth_headers, tmp_path, user_id)

    _level(client, auth_headers, book_id, "semantic", target_cefr="A2")
    again = _level(client, auth_headers, book_id, "semantic", target_cefr="A2")
    assert again["cached"] is False


def test_unknown_mode_is_rejected(client, auth_headers, tmp_path):
    user_id = _create_user(client, auth_headers)
    book_id = _import_book(client, auth_headers, tmp_path, user_id)

    res = client.post(
        "/reading/level",
        headers=auth_headers,
        json={"book_id": book_id, "block_index": 0, "mode": "telepathy"},
    )
    assert res.status_code == 400


def test_missing_block_is_404(client, auth_headers, tmp_path):
    user_id = _create_user(client, auth_headers)
    book_id = _import_book(client, auth_headers, tmp_path, user_id)

    res = client.post(
        "/reading/level",
        headers=auth_headers,
        json={"book_id": book_id, "block_index": 9999, "mode": "inline"},
    )
    assert res.status_code == 404


def test_target_falls_back_to_the_readers_placement(client, auth_headers, tmp_path):
    user_id = _create_user(client, auth_headers, cefr_level="A2")
    book_id = _import_book(client, auth_headers, tmp_path, user_id)

    body = _level(client, auth_headers, book_id, "inline", user_id=user_id)
    assert body["target_cefr"] == "A2"


def test_session_open_is_idempotent_per_day(client, auth_headers, tmp_path):
    user_id = _create_user(client, auth_headers)
    book_id = _import_book(client, auth_headers, tmp_path, user_id)

    first = client.post(
        f"/books/{book_id}/sessions", headers=auth_headers, json={"user_id": user_id}
    )
    second = client.post(
        f"/books/{book_id}/sessions", headers=auth_headers, json={"user_id": user_id}
    )
    assert first.status_code == 201
    assert second.status_code == 201
    # Reopening a book four times in an evening must not fragment the day.
    assert first.json()["id"] == second.json()["id"]


def test_heartbeat_accumulates_seconds(client, auth_headers, tmp_path):
    user_id = _create_user(client, auth_headers)
    book_id = _import_book(client, auth_headers, tmp_path, user_id)

    session = client.post(
        f"/books/{book_id}/sessions", headers=auth_headers, json={"user_id": user_id}
    ).json()

    for _ in range(3):
        res = client.patch(
            f"/books/{book_id}/sessions/{session['id']}", headers=auth_headers, json={"seconds": 30}
        )
        assert res.status_code == 200

    assert res.json()["seconds"] == 90


def test_heartbeat_on_unknown_session_is_404(client, auth_headers, tmp_path):
    user_id = _create_user(client, auth_headers)
    book_id = _import_book(client, auth_headers, tmp_path, user_id)

    res = client.patch(
        f"/books/{book_id}/sessions/nope", headers=auth_headers, json={"seconds": 30}
    )
    assert res.status_code == 404


def test_session_and_position_share_one_row_per_day(client, auth_headers, tmp_path):
    """Words come from position advances, seconds from heartbeats — both must
    land on the same day row or the goal ring and the time read disagree."""
    user_id = _create_user(client, auth_headers)
    book_id = _import_book(client, auth_headers, tmp_path, user_id)

    session = client.post(
        f"/books/{book_id}/sessions", headers=auth_headers, json={"user_id": user_id}
    ).json()
    client.put(
        f"/books/{book_id}/position", headers=auth_headers, json={"user_id": user_id, "block_index": 1}
    )
    updated = client.patch(
        f"/books/{book_id}/sessions/{session['id']}", headers=auth_headers, json={"seconds": 60}
    ).json()

    assert updated["seconds"] == 60
    assert updated["words_read"] > 0
