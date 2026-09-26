"""The dashboard's consistency calendar: pages from reading_sessions, cards
from review_logs, and it has to agree with what those tables say."""

from datetime import date, timedelta

from app.db import get_connection
from app.utils.ids import uuid7
from app.utils.time import iso8601_utc_now

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


def _import_book(client, auth_headers, tmp_path, user_id):
    source = tmp_path / "Sample.txt"
    source.write_text(SAMPLE, encoding="utf-8")
    res = client.post(
        "/books/import", headers=auth_headers, json={"user_id": user_id, "paths": [str(source)]}
    )
    assert res.status_code == 202
    return res.json()[0]["id"]


def _session_on(book_id, user_id, day, *, words, seconds):
    """A reading session on a given local day, written the way the reader's
    own position updates write them."""
    conn = get_connection()
    try:
        conn.execute(
            "INSERT INTO reading_sessions (id, book_id, user_id, local_date, started_at, "
            "ended_at, words_read, seconds) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (uuid7(), book_id, user_id, day, iso8601_utc_now(), iso8601_utc_now(), words, seconds),
        )
        conn.commit()
    finally:
        conn.close()


def _activity(client, auth_headers, user_id, days=365):
    res = client.get(
        "/activity", headers=auth_headers, params={"user_id": user_id, "days": days}
    )
    assert res.status_code == 200, res.text
    return res.json()


def test_requires_a_token(client):
    assert client.get("/activity", params={"user_id": "x"}).status_code == 401


def test_every_day_in_the_window_comes_back_including_the_empty_ones(
    client, auth_headers
):
    """A calendar is mostly a picture of the gaps. A client that received only
    the busy days would have to invent the rest back."""
    user_id = _create_user(client, auth_headers)
    out = _activity(client, auth_headers, user_id, days=30)
    assert len(out["days"]) == 30
    assert out["days"][-1]["date"] == date.today().isoformat()
    assert out["days"][0]["date"] == (date.today() - timedelta(days=29)).isoformat()
    assert all(d["pages"] == 0 and d["reviews"] == 0 for d in out["days"])
    assert out["active_days"] == 0


def test_a_day_read_on_shows_its_pages_and_minutes(client, auth_headers, tmp_path):
    user_id = _create_user(client, auth_headers)
    book_id = _import_book(client, auth_headers, tmp_path, user_id)
    yesterday = (date.today() - timedelta(days=1)).isoformat()
    _session_on(book_id, user_id, yesterday, words=900, seconds=1800)

    out = _activity(client, auth_headers, user_id, days=7)
    day = next(d for d in out["days"] if d["date"] == yesterday)
    assert day["pages"] > 0
    assert day["minutes"] == 30
    assert out["active_days"] == 1
    assert out["total_pages"] == day["pages"]


def test_days_outside_the_window_are_left_out(client, auth_headers, tmp_path):
    """Asking for a week must not return a year's worth of totals."""
    user_id = _create_user(client, auth_headers)
    book_id = _import_book(client, auth_headers, tmp_path, user_id)
    _session_on(book_id, user_id, (date.today() - timedelta(days=200)).isoformat(),
                words=900, seconds=600)

    week = _activity(client, auth_headers, user_id, days=7)
    assert week["total_pages"] == 0
    assert week["active_days"] == 0

    year = _activity(client, auth_headers, user_id, days=365)
    assert year["total_pages"] > 0
    assert year["active_days"] == 1


def test_reviews_land_on_the_day_they_were_answered(client, auth_headers, tmp_path):
    """Cards answered are the other half of showing up: a day spent only on
    reviews is not an empty day."""
    user_id = _create_user(client, auth_headers)
    res = client.post(
        "/vocabulary/manual",
        headers=auth_headers,
        json={
            "user_id": user_id,
            "word": "ubiquitous",
            "pos": "adjective",
            "definition": "found everywhere",
        },
    )
    assert res.status_code in (200, 201), res.text
    vocab_id = res.json()["word"]["id"]
    rated = client.post(
        f"/review/cards/{vocab_id}/rate",
        headers=auth_headers,
        json={"user_id": user_id, "rating": 3},
    )
    assert rated.status_code == 200, rated.text

    out = _activity(client, auth_headers, user_id, days=7)
    today = next(d for d in out["days"] if d["date"] == date.today().isoformat())
    assert today["reviews"] == 1
    assert out["total_reviews"] == 1
    assert out["active_days"] == 1


def test_another_readers_days_are_not_counted(client, auth_headers, tmp_path):
    mine = _create_user(client, auth_headers)
    theirs = _create_user(client, auth_headers)
    book_id = _import_book(client, auth_headers, tmp_path, theirs)
    _session_on(book_id, theirs, date.today().isoformat(), words=900, seconds=600)

    assert _activity(client, auth_headers, mine, days=7)["active_days"] == 0
    assert _activity(client, auth_headers, theirs, days=7)["active_days"] == 1


def test_a_silly_window_is_clamped_rather_than_refused(client, auth_headers):
    user_id = _create_user(client, auth_headers)
    assert len(_activity(client, auth_headers, user_id, days=100000)["days"]) == 400
    assert len(_activity(client, auth_headers, user_id, days=0)["days"]) == 1
