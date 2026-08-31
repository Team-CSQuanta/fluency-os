import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app


@pytest.fixture()
def client(tmp_path):
    settings.db_path = str(tmp_path / "test.db")
    settings.token = "test-token"
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def auth_headers():
    return {"X-FluencyOS-Token": "test-token"}
