"""Reading goal, streak and shelf-state tests (spec §7.1).

The goal ring, week bars, streak chip and the Reading/Not started filters all
read from the same two places: reading_sessions rows written by position
updates, and the reading_positions join on GET /books.
"""

from datetime import date, timedelta

from app.services import pagination

# Long enough that reading it end to end clears a small daily goal.
PARAGRAPH = " ".join(["word"] * 300)
SAMPLE = f"{PARAGRAPH}\n\n{PARAGRAPH}\n\n{PARAGRAPH}"


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


def _import_book(client, auth_headers, tmp_path, user_id, *, name="Goal Sample", goal=True):
    source = tmp_path / f"{name}.txt"
    source.write_text(SAMPLE, encoding="utf-8")
    res = client.post(
        "/books/import",
        headers=auth_headers,
        json={"user_id": user_id, "paths": [str(source)], "count_toward_goal": goal},
    )
    assert res.status_code == 202
    return res.json()[0]["id"]


def _stats(client, auth_headers, user_id):
    res = client.get("/reading/stats", headers=auth_headers, params={"user_id": user_id})
    assert res.status_code == 200
    return res.json()


def _read_to(client, auth_headers, book_id, user_id, block_index):
    res = client.put(
        f"/books/{book_id}/position",
        headers=auth_headers,
        json={"user_id": user_id, "block_index": block_index},
    )
    assert res.status_code == 204


def test_stats_requires_token(client):
    assert client.get("/reading/stats", params={"user_id": "x"}).status_code == 401


def test_fresh_user_has_default_goal_and_empty_week(client, auth_headers):
    user_id = _create_user(client, auth_headers)
    body = _stats(client, auth_headers, user_id)

    assert body["goal_pages"] == 20
    assert body["pages_today"] == 0
    assert body["streak_days"] == 0
    assert body["goal_met"] is False
    assert len(body["week"]) == 7
    assert [d["pages"] for d in body["week"]] == [0] * 7
    # The last bar is today.
    assert body["week"][-1]["date"] == date.today().isoformat()


def test_reading_credits_pages_toward_today(client, auth_headers, tmp_path):
    user_id = _create_user(client, auth_headers)
    book_id = _import_book(client, auth_headers, tmp_path, user_id)

    _read_to(client, auth_headers, book_id, user_id, 2)

    body = _stats(client, auth_headers, user_id)
    assert body["pages_today"] == pagination.pages_from_words(900)
    assert body["books_today"] == 1
    assert body["week"][-1]["pages"] == body["pages_today"]


def test_rereading_earlier_blocks_does_not_double_count(client, auth_headers, tmp_path):
    user_id = _create_user(client, auth_headers)
    book_id = _import_book(client, auth_headers, tmp_path, user_id)

    _read_to(client, auth_headers, book_id, user_id, 2)
    first = _stats(client, auth_headers, user_id)["pages_today"]

    # Flip back to the start and forward again — max_block_seen is unchanged,
    # so the day's total must not move.
    _read_to(client, auth_headers, book_id, user_id, 0)
    _read_to(client, auth_headers, book_id, user_id, 2)

    assert _stats(client, auth_headers, user_id)["pages_today"] == first


def test_book_excluded_from_goal_is_not_credited(client, auth_headers, tmp_path):
    user_id = _create_user(client, auth_headers)
    book_id = _import_book(client, auth_headers, tmp_path, user_id, name="Reference", goal=False)

    _read_to(client, auth_headers, book_id, user_id, 2)

    body = _stats(client, auth_headers, user_id)
    assert body["pages_today"] == 0
    assert body["books_today"] == 0


def test_goal_update_recomputes_met_and_streak(client, auth_headers, tmp_path):
    user_id = _create_user(client, auth_headers)
    book_id = _import_book(client, auth_headers, tmp_path, user_id)
    _read_to(client, auth_headers, book_id, user_id, 2)

    assert _stats(client, auth_headers, user_id)["goal_met"] is False

    res = client.put(
        "/reading/goal", headers=auth_headers, json={"user_id": user_id, "daily_page_goal": 3}
    )
    assert res.status_code == 200
    body = res.json()
    assert body["goal_pages"] == 3
    assert body["goal_met"] is True
    # Today counts the moment the goal drops below what has already been read.
    assert body["streak_days"] == 1
    assert _stats(client, auth_headers, user_id)["goal_pages"] == 3


def test_goal_must_be_positive(client, auth_headers):
    user_id = _create_user(client, auth_headers)
    res = client.put(
        "/reading/goal", headers=auth_headers, json={"user_id": user_id, "daily_page_goal": 0}
    )
    assert res.status_code == 422


def test_streak_survives_a_day_that_has_only_just_started(client, auth_headers, tmp_path, monkeypatch):
    """Yesterday's met goal must still read as a streak at 9am today, before
    any pages have been read — otherwise the chip flickers to 0 every morning."""
    user_id = _create_user(client, auth_headers)
    book_id = _import_book(client, auth_headers, tmp_path, user_id)

    from app.services import reading_goal

    yesterday = (date.today() - timedelta(days=1)).isoformat()
    monkeypatch.setattr(reading_goal, "local_date_today", lambda: yesterday)
    _read_to(client, auth_headers, book_id, user_id, 2)
    monkeypatch.undo()

    client.put("/reading/goal", headers=auth_headers, json={"user_id": user_id, "daily_page_goal": 3})
    body = _stats(client, auth_headers, user_id)

    assert body["pages_today"] == 0
    assert body["streak_days"] == 1


def test_books_list_reports_last_read_and_percent(client, auth_headers, tmp_path):
    user_id = _create_user(client, auth_headers)
    book_id = _import_book(client, auth_headers, tmp_path, user_id)

    before = client.get("/books", headers=auth_headers, params={"user_id": user_id}).json()[0]
    assert before["last_read_at"] is None
    assert before["percent"] == 0.0

    _read_to(client, auth_headers, book_id, user_id, 1)

    after = client.get("/books", headers=auth_headers, params={"user_id": user_id}).json()[0]
    assert after["last_read_at"] is not None
    assert after["percent"] > 0


def test_counts_move_from_not_started_to_reading_on_first_open(client, auth_headers, tmp_path):
    user_id = _create_user(client, auth_headers)
    book_id = _import_book(client, auth_headers, tmp_path, user_id)

    counts = client.get("/books/counts", headers=auth_headers, params={"user_id": user_id}).json()
    assert counts == {"all": 1, "reading": 0, "not_started": 1, "finished": 0}

    _read_to(client, auth_headers, book_id, user_id, 1)

    counts = client.get("/books/counts", headers=auth_headers, params={"user_id": user_id}).json()
    assert counts == {"all": 1, "reading": 1, "not_started": 0, "finished": 0}
