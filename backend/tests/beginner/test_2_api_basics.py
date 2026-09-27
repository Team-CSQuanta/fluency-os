"""Beginner tests, part 2: testing the backend API (integration tests).

These tests talk to the real FastAPI backend, the same way the app's screens
do: they send an HTTP request and check the response. Each test gets its own
fresh, empty database (see tests/conftest.py), so tests never affect each
other and never touch real user data.

Two helpers come from pytest "fixtures" in tests/conftest.py:

    client        – sends requests to the backend
    auth_headers  – the secret token the app sends with every request
"""


def make_learner(client, auth_headers, name="Ana"):
    """Creates a learner and returns their id — a small helper several tests use."""
    response = client.post(
        "/users",
        headers=auth_headers,
        json={
            "display_name": name,
            "native_language": "Bengali",
            "target_language": "English",
            "data_folder": "~/FluencyOS",
        },
    )
    assert response.status_code == 201  # 201 = "Created"
    return response.json()["id"]


def test_the_backend_is_running(client, auth_headers):
    """The simplest API test: ask the backend if it is healthy."""
    response = client.get("/health", headers=auth_headers)

    assert response.status_code == 200  # 200 = "OK"


def test_requests_without_the_secret_token_are_refused(client):
    """Security: only the FluencyOS app itself may use the backend."""
    response = client.get("/health")  # no token sent

    assert response.status_code == 401  # 401 = "Unauthorized"


def test_a_new_learner_can_be_created_and_read_back(client, auth_headers):
    # Arrange + Act: create a learner
    learner_id = make_learner(client, auth_headers, name="Ana")

    # Act: read the learner back
    response = client.get(f"/users/{learner_id}", headers=auth_headers)

    # Assert: the same name comes back
    assert response.status_code == 200
    assert response.json()["display_name"] == "Ana"


def test_a_saved_word_appears_in_the_vocabulary_list(client, auth_headers):
    # Arrange
    learner_id = make_learner(client, auth_headers)

    # Act: save the word "harbour"
    saved = client.post(
        "/vocabulary/manual",
        headers=auth_headers,
        json={
            "user_id": learner_id,
            "word": "harbour",
            "pos": "noun",
            "definition": "A sheltered place for ships.",
            "synonyms": ["port"],
        },
    )

    # Assert: it was saved, and the list now contains exactly that word
    assert saved.status_code == 200
    words = client.get("/vocabulary", headers=auth_headers, params={"user_id": learner_id}).json()
    assert len(words) == 1
    assert words[0]["word"] == "harbour"


def test_a_saved_word_becomes_a_flashcard_to_review(client, auth_headers):
    """Saving a word should add one new card to the learner's reviews."""
    # Arrange
    learner_id = make_learner(client, auth_headers)

    # Act
    client.post(
        "/vocabulary/manual",
        headers=auth_headers,
        json={"user_id": learner_id, "word": "harbour", "pos": "noun", "definition": "A place for ships."},
    )
    stats = client.get("/review/stats", headers=auth_headers, params={"user_id": learner_id}).json()

    # Assert
    assert stats["total_cards"] == 1
    assert stats["new_available"] == 1


def test_a_new_learner_cannot_pick_a_high_level_without_the_test(client, auth_headers):
    """The same level rule as in part 1, now checked through the API."""
    learner_id = make_learner(client, auth_headers)

    response = client.patch(f"/users/{learner_id}/placement", headers=auth_headers, json={"cefr_level": "B2"})

    assert response.status_code == 403  # 403 = "Forbidden"
