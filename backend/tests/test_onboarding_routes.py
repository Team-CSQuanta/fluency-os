def test_onboarding_round_trip(client, auth_headers):
    create_res = client.post(
        "/users",
        headers=auth_headers,
        json={
            "display_name": "Rafsan",
            "native_language": "Bengali",
            "target_language": "English",
            "data_folder": "~/FluencyOS",
        },
    )
    assert create_res.status_code == 201
    user = create_res.json()
    assert user["onboarding_completed_at"] is None
    user_id = user["id"]

    get_res = client.get(f"/users/{user_id}", headers=auth_headers)
    assert get_res.status_code == 200
    assert get_res.json()["display_name"] == "Rafsan"

    placement_res = client.patch(
        f"/users/{user_id}/placement", headers=auth_headers, json={"cefr_level": "B2"}
    )
    assert placement_res.status_code == 200
    assert placement_res.json()["cefr_level"] == "B2"

    settings_res = client.put(
        f"/users/{user_id}/settings",
        headers=auth_headers,
        json={
            "llm_mode": "local",
            "llm_model_id": "balanced",
            "api_provider": None,
            "api_key_ref": None,
            "daily_goal_spec": {
                "reviews_cleared": {"enabled": True, "target": 20},
                "conversation_minutes": {"enabled": True, "target": 3},
                "watch_minutes": {"enabled": False, "target": 15},
                "reading_minutes": {"enabled": False, "target": 15},
                "new_words": {"enabled": False, "target": 5},
            },
            "notifications_enabled": True,
            "quiet_hours_start": "22:00",
            "quiet_hours_end": "08:00",
        },
    )
    assert settings_res.status_code == 204

    companion_res = client.post(
        f"/users/{user_id}/companion",
        headers=auth_headers,
        json={"companion_species": "fox", "starting_biome": "meadow"},
    )
    assert companion_res.status_code == 204

    complete_res = client.post(f"/users/{user_id}/onboarding/complete", headers=auth_headers)
    assert complete_res.status_code == 200
    completed_user = complete_res.json()
    assert completed_user["onboarding_completed_at"] is not None

    final_get = client.get(f"/users/{user_id}", headers=auth_headers)
    assert final_get.json()["onboarding_completed_at"] is not None


def test_api_key_mode_never_stores_a_raw_key(client, auth_headers):
    user = client.post(
        "/users",
        headers=auth_headers,
        json={
            "display_name": "Test",
            "native_language": "Bengali",
            "target_language": "English",
            "data_folder": "~/FluencyOS",
        },
    ).json()

    client.put(
        f"/users/{user['id']}/settings",
        headers=auth_headers,
        json={
            "llm_mode": "api",
            "llm_model_id": None,
            "api_provider": "pending-configuration",
            "api_key_ref": "pending-keychain-setup",
            "daily_goal_spec": {
                "reviews_cleared": {"enabled": True, "target": 20},
                "conversation_minutes": {"enabled": False, "target": 3},
                "watch_minutes": {"enabled": False, "target": 15},
                "reading_minutes": {"enabled": False, "target": 15},
                "new_words": {"enabled": False, "target": 5},
            },
            "notifications_enabled": False,
            "quiet_hours_start": "22:00",
            "quiet_hours_end": "08:00",
        },
    )

    # api_key_ref must only ever be a placeholder string, never a real secret shape.
    from app.db import get_connection
    from app.config import settings as app_settings

    conn = get_connection(app_settings.db_path)
    row = conn.execute(
        "SELECT api_key_ref FROM user_settings WHERE user_id = ?", (user["id"],)
    ).fetchone()
    conn.close()
    assert row["api_key_ref"] == "pending-keychain-setup"


def test_missing_token_rejected(client):
    res = client.post(
        "/users",
        json={
            "display_name": "X",
            "native_language": "Y",
            "target_language": "English",
            "data_folder": "~/FluencyOS",
        },
    )
    assert res.status_code == 401


def test_unknown_user_returns_404(client, auth_headers):
    res = client.get("/users/does-not-exist", headers=auth_headers)
    assert res.status_code == 404
