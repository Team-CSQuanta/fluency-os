def test_health_requires_token(client):
    res = client.get("/health")
    assert res.status_code == 401


def test_health_ok_with_token(client, auth_headers):
    res = client.get("/health", headers=auth_headers)
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert body["schema_version"] == "0005"
