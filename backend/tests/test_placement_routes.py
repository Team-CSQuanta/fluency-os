def test_questions_require_token(client):
    res = client.get("/placement/questions")
    assert res.status_code == 401


def test_questions_omit_correct_answer(client, auth_headers):
    res = client.get("/placement/questions", headers=auth_headers)
    assert res.status_code == 200
    body = res.json()
    assert len(body) == 20
    for q in body:
        assert "correct_index" not in q
        assert len(q["options"]) == 4


def test_score_round_trip(client, auth_headers):
    questions = client.get("/placement/questions", headers=auth_headers).json()
    # Answer everything with option 0 — deterministic, doesn't need the answer key.
    answers = [{"question_id": q["id"], "selected_index": 0} for q in questions]

    res = client.post("/placement/score", headers=auth_headers, json={"answers": answers})
    assert res.status_code == 200
    body = res.json()
    assert body["estimated_cefr"] in {"A1", "A2", "B1", "B2", "C1", "C2"}
    assert body["total_questions"] == 20
    assert len(body["breakdown"]) >= 1
