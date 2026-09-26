def test_health_requires_token(client):
    res = client.get("/health")
    assert res.status_code == 401


def test_health_ok_with_token(client, auth_headers):
    """The reported schema version is the newest migration on disk.

    Derived rather than hardcoded. The literal had to be hand-edited every time
    a migration was added, which meant the suite broke on every schema change
    for a reason that was never the change itself — and the thing actually
    worth asserting is that /health reports what the database is really at, not
    that it equals some number written down last month.
    """
    from app.migrations.runner import _migration_files

    latest = _migration_files()[-1].stem.split("_")[0]
    res = client.get("/health", headers=auth_headers)
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert body["schema_version"] == latest
