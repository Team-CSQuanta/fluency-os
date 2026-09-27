def test_recommend_returns_the_catalog_with_a_recommendation(client, auth_headers):
    res = client.post(
        "/engine/recommend",
        headers=auth_headers,
        json={"cpu_cores": 4, "total_ram_bytes": 6 * 1024**3, "gpu_vendor": None},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["recommended"] == "qwen2.5-1.5b"
    assert body["reason"]
    assert {m["fit"] for m in body["models"]} <= {"good", "tight", "too_big"}
    assert [m for m in body["models"] if m["recommended"]][0]["key"] == body["recommended"]


def test_recommend_requires_the_token(client):
    assert client.post("/engine/recommend", json={"cpu_cores": 4, "total_ram_bytes": 1}).status_code in (401, 403)
