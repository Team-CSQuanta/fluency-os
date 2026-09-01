"""Reader display preferences (spec Phase 2 step 5).

The Text panel used to forget everything on each book open; these cover the
round-trip and the two things that must not break — server-side bounds, and
not clobbering the rest of user_settings.
"""


def _create_user(client, auth_headers):
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
    return res.json()["id"]


def _prefs(client, auth_headers, user_id):
    res = client.get("/reading/prefs", headers=auth_headers, params={"user_id": user_id})
    assert res.status_code == 200
    return res.json()


PREFS = {
    "font_size": 19.0,
    "page_theme": "sepia",
    "heat_on": False,
    "panel_open": False,
    "panel_tab": "marks",
}


def test_prefs_requires_token(client):
    assert client.get("/reading/prefs", params={"user_id": "x"}).status_code == 401


def test_reader_with_no_settings_row_gets_defaults(client, auth_headers):
    """Never opening a book is not an error state."""
    user_id = _create_user(client, auth_headers)
    body = _prefs(client, auth_headers, user_id)

    assert body == {
        "font_size": 15.5,
        "page_theme": "auto",
        "heat_on": True,
        "panel_open": True,
        "panel_tab": "toc",
    }


def test_prefs_round_trip(client, auth_headers):
    user_id = _create_user(client, auth_headers)

    res = client.put("/reading/prefs", headers=auth_headers, json={"user_id": user_id, **PREFS})
    assert res.status_code == 200
    assert res.json() == PREFS
    assert _prefs(client, auth_headers, user_id) == PREFS


def test_font_size_is_bounded_server_side(client, auth_headers):
    user_id = _create_user(client, auth_headers)
    for bad in (4, 400):
        res = client.put(
            "/reading/prefs",
            headers=auth_headers,
            json={"user_id": user_id, **{**PREFS, "font_size": bad}},
        )
        assert res.status_code == 422


def test_unknown_theme_and_tab_are_rejected(client, auth_headers):
    user_id = _create_user(client, auth_headers)
    for field, bad in (("page_theme", "neon"), ("panel_tab", "telepathy")):
        res = client.put(
            "/reading/prefs",
            headers=auth_headers,
            json={"user_id": user_id, **{**PREFS, field: bad}},
        )
        assert res.status_code == 422


def test_saving_prefs_does_not_clobber_other_settings(client, auth_headers):
    """The whole reason these get their own endpoint rather than reusing
    PUT /users/{id}/settings, which rewrites the row from onboarding fields."""
    user_id = _create_user(client, auth_headers)

    assert (
        client.put(
            f"/users/{user_id}/settings",
            headers=auth_headers,
            json={
                "llm_mode": "api",
                "llm_model_id": "some-model",
                "api_provider": "anthropic",
                "api_key_ref": "ref-1",
                "daily_goal_spec": {
                    "reviews_cleared": {"enabled": True, "target": 40},
                    "conversation_minutes": {"enabled": True, "target": 10},
                    "watch_minutes": {"enabled": True, "target": 20},
                    "reading_minutes": {"enabled": True, "target": 30},
                    "new_words": {"enabled": True, "target": 8},
                },
                "notifications_enabled": True,
                "quiet_hours_start": "22:00",
                "quiet_hours_end": "08:00",
            },
        ).status_code
        == 204
    )

    client.put("/reading/prefs", headers=auth_headers, json={"user_id": user_id, **PREFS})

    from app.config import settings
    from app.db import get_connection

    conn = get_connection(settings.db_path)
    row = conn.execute(
        "SELECT llm_model_id, api_provider FROM user_settings WHERE user_id = ?", (user_id,)
    ).fetchone()
    conn.close()

    assert row["llm_model_id"] == "some-model"
    assert row["api_provider"] == "anthropic"


def test_reader_prefs_survive_the_daily_goal_being_set(client, auth_headers):
    """Both write to user_settings via their own upsert; neither may reset
    the other's columns to their defaults."""
    user_id = _create_user(client, auth_headers)
    client.put("/reading/prefs", headers=auth_headers, json={"user_id": user_id, **PREFS})
    client.put("/reading/goal", headers=auth_headers, json={"user_id": user_id, "daily_page_goal": 30})

    assert _prefs(client, auth_headers, user_id) == PREFS
    stats = client.get("/reading/stats", headers=auth_headers, params={"user_id": user_id}).json()
    assert stats["goal_pages"] == 30
