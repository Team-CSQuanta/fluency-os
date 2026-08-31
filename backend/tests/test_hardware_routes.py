def test_assess_hardware_requires_token(client):
    res = client.post("/engine/assess-hardware", json={"cpu_cores": 4, "total_ram_bytes": 6 * 1024**3})
    assert res.status_code == 401


def test_assess_hardware_round_trip(client, auth_headers):
    res = client.post(
        "/engine/assess-hardware",
        headers=auth_headers,
        json={"cpu_cores": 4, "total_ram_bytes": 6 * 1024**3},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["recommended_tier"] == "light"
    assert body["any_local_capable"] is True
    assert len(body["tiers"]) == 3
