import sqlite3

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app


@pytest.fixture(scope="session")
def _started_db(tmp_path_factory) -> str:
    """A database exactly as the app leaves it after starting up: migrated,
    backfilled and seeded with the scene corpus.

    Starting the app does all of that on an empty database, and the scene
    import alone is ~35,000 rows parsed out of 32MB of JSON — about a second.
    Paid once per test worker here instead of once per test, which was most of
    the suite's run time. Each test still gets its own copy (see `client`),
    so nothing one test writes can reach another."""
    path = tmp_path_factory.mktemp("started") / "started.db"
    settings.db_path = str(path)
    settings.token = "test-token"
    with TestClient(app):
        pass
    return str(path)


@pytest.fixture()
def client(tmp_path, _started_db):
    settings.db_path = str(tmp_path / "test.db")
    settings.token = "test-token"
    # The backup API, not a file copy: the template is in WAL mode, and a
    # copy of the main file alone could miss pages still in its -wal file.
    with sqlite3.connect(_started_db) as src, sqlite3.connect(settings.db_path) as dst:
        src.backup(dst)
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def auth_headers():
    return {"X-FluencyOS-Token": "test-token"}
