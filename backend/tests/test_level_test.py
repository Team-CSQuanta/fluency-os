"""The level test: passing it is the only way up a level."""

import json
import random
from datetime import datetime, timedelta, timezone

import pytest

from app.config import settings
from app.db import get_connection
from app.migrations.runner import run_migrations
from app.services import level_test

NOW = datetime(2026, 6, 1, 12, 0, tzinfo=timezone.utc)


def _conn(tmp_path, level="B1"):
    settings.db_path = str(tmp_path / "lt.db")
    conn = get_connection()
    run_migrations(conn)
    conn.execute(
        "INSERT INTO users (id, display_name, native_language, target_language, cefr_level, created_at) "
        "VALUES ('u1', 'T', 'bn', 'en', ?, '2026-01-01T00:00:00Z')",
        (level,),
    )
    conn.commit()
    return conn


def _answers(conn, attempt_id, *, right: int):
    """The first `right` answers correct, the rest wrong."""
    qs = json.loads(conn.execute("SELECT questions FROM level_test_attempts WHERE id = ?", (attempt_id,)).fetchone()[0])
    return [q["answer"] if i < right else (q["answer"] + 1) % 4 for i, q in enumerate(qs)]


def test_a_test_mixes_the_level_with_the_one_below_and_hides_the_answers(tmp_path):
    conn = _conn(tmp_path, "B2")
    attempt = level_test.start(conn, "u1", "C1", now=NOW)
    assert len(attempt["questions"]) == 15
    assert all("answer" not in q for q in attempt["questions"])
    served = json.loads(conn.execute("SELECT questions FROM level_test_attempts").fetchone()[0])
    levels = [q["level"] for q in served]
    assert levels.count("C1") == 12 and levels.count("B2") == 3
    assert {q["skill"] for q in served} == {"grammar", "vocabulary", "reading"}


def test_choices_are_shuffled_between_tests():
    orders: dict[str, set[tuple]] = {}
    for seed in range(40):
        for q in level_test.build(_Stub(), "u", "A2", random.Random(seed)):
            orders.setdefault(q["id"], set()).add(tuple(q["options"]))
    # A question drawn several times comes with its choices in several orders.
    assert any(len(o) > 1 for o in orders.values())
    assert max(len(o) for o in orders.values()) > 3


class _Stub:
    """A connection with no past attempts."""

    def execute(self, *a, **kw):
        return []


def test_questions_just_seen_are_not_served_again_while_the_pool_allows(tmp_path):
    conn = _conn(tmp_path, "A1")
    first = level_test.start(conn, "u1", "A2", now=NOW)
    level_test.submit(conn, "u1", first["id"], _answers(conn, first["id"], right=0), now=NOW)
    later = NOW + level_test.RETRY_WAIT + timedelta(minutes=1)
    second = level_test.start(conn, "u1", "A2", now=later)
    at_level = lambda a: {q["id"] for q in a["questions"] if q["id"].startswith("a2-")}  # noqa: E731
    assert at_level(first) and not (at_level(first) & at_level(second))


def test_passing_moves_the_learner_up(tmp_path):
    conn = _conn(tmp_path, "B1")
    attempt = level_test.start(conn, "u1", "B2", now=NOW)
    result = level_test.submit(conn, "u1", attempt["id"], _answers(conn, attempt["id"], right=12), now=NOW)
    assert result.passed and result.correct == 12 and result.pass_mark == 12
    assert result.new_level == "B2"
    assert level_test.current_level(conn, "u1") == "B2"
    assert sum(s["total"] for s in result.by_skill) == 15


def test_failing_keeps_the_level_and_makes_the_level_wait(tmp_path):
    conn = _conn(tmp_path, "B1")
    attempt = level_test.start(conn, "u1", "B2", now=NOW)
    result = level_test.submit(conn, "u1", attempt["id"], _answers(conn, attempt["id"], right=11), now=NOW)
    assert not result.passed and result.retry_after
    assert level_test.current_level(conn, "u1") == "B1"
    with pytest.raises(level_test.LevelTestError, match="again after"):
        level_test.start(conn, "u1", "B2", now=NOW + timedelta(hours=1))
    # Another level is not held up by it, and the wait does end.
    level_test.start(conn, "u1", "C1", now=NOW + timedelta(hours=1))
    level_test.start(conn, "u1", "B2", now=NOW + level_test.RETRY_WAIT + timedelta(minutes=1))


def test_answers_sent_after_the_time_limit_score_nothing(tmp_path):
    conn = _conn(tmp_path, "A2")
    attempt = level_test.start(conn, "u1", "B1", now=NOW)
    late = NOW + level_test.TIME_LIMIT + timedelta(minutes=5)
    result = level_test.submit(conn, "u1", attempt["id"], _answers(conn, attempt["id"], right=15), now=late)
    assert result.correct == 0 and not result.passed


def test_a_test_is_marked_once(tmp_path):
    conn = _conn(tmp_path, "A2")
    attempt = level_test.start(conn, "u1", "B1", now=NOW)
    level_test.submit(conn, "u1", attempt["id"], [0] * 15, now=NOW)
    with pytest.raises(level_test.LevelTestError):
        level_test.submit(conn, "u1", attempt["id"], [0] * 15, now=NOW)


def test_the_test_is_only_for_moving_up(tmp_path):
    conn = _conn(tmp_path, "B2")
    with pytest.raises(level_test.LevelTestError):
        level_test.start(conn, "u1", "B1", now=NOW)
    with pytest.raises(level_test.LevelTestError):
        level_test.start(conn, "u1", "B2", now=NOW)
    level_test.move_down(conn, "u1", "A2")
    assert level_test.current_level(conn, "u1") == "A2"
    with pytest.raises(level_test.LevelTestError):
        level_test.move_down(conn, "u1", "C1")


def test_generated_vocabulary_never_gives_the_answer_away():
    for level in ("B2", "C1", "C2"):
        for q in level_test.generated(level, random.Random(0)):
            assert len(set(q.choices)) == 4
            if "means" in q.prompt:
                assert q.choices[0].lower()[:5] not in q.prompt.lower()


def test_the_profile_refuses_a_level_jump_without_the_test(client, auth_headers):
    from tests.test_conversation import _create_user

    user_id = _create_user(client, auth_headers)
    first = client.patch(f"/users/{user_id}/placement", headers=auth_headers, json={"cefr_level": "B1"})
    assert first.status_code == 200
    # Redone during onboarding, placement may still go up...
    assert client.patch(f"/users/{user_id}/placement", headers=auth_headers, json={"cefr_level": "B2"}).status_code == 200
    assert client.patch(f"/users/{user_id}/placement", headers=auth_headers, json={"cefr_level": "B1"}).status_code == 200
    # ...but once onboarding is over, only the test moves it up.
    client.post(f"/users/{user_id}/onboarding/complete", headers=auth_headers)
    assert client.patch(f"/users/{user_id}/placement", headers=auth_headers, json={"cefr_level": "C2"}).status_code == 403
    up = client.patch(f"/users/{user_id}", headers=auth_headers, json={"cefr_level": "C1"})
    assert up.status_code == 403 and "level test" in up.json()["detail"]
    down = client.patch(f"/users/{user_id}", headers=auth_headers, json={"cefr_level": "A2"})
    assert down.status_code == 200 and down.json()["cefr_level"] == "A2"

    overview = client.get("/level-test", headers=auth_headers, params={"user_id": user_id}).json()
    assert overview["current"] == "A2"
    started = client.post("/level-test/attempts", headers=auth_headers, json={"user_id": user_id, "level": "B1"})
    assert started.status_code == 201
    assert all("answer" not in q for q in started.json()["questions"])


def test_starting_again_resumes_the_same_test_instead_of_dealing_new_questions(tmp_path):
    conn = _conn(tmp_path, "B1")
    first = level_test.start(conn, "u1", "B2", now=NOW)
    again = level_test.start(conn, "u1", "B2", now=NOW + timedelta(minutes=3))
    assert again["id"] == first["id"] and again["questions"] == first["questions"]


def test_a_test_left_to_run_out_counts_as_a_failed_attempt(tmp_path):
    conn = _conn(tmp_path, "B1")
    level_test.start(conn, "u1", "B2", now=NOW)
    after = NOW + level_test.TIME_LIMIT + timedelta(minutes=5)
    with pytest.raises(level_test.LevelTestError, match="again after"):
        level_test.start(conn, "u1", "B2", now=after)
