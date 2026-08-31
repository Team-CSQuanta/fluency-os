import sqlite3

from fastapi import APIRouter, Depends

from app.db import get_db
from app.security import require_token

router = APIRouter(dependencies=[Depends(require_token)])


@router.get("/health")
def health(conn: sqlite3.Connection = Depends(get_db)) -> dict:
    row = conn.execute("SELECT value FROM app_meta WHERE key = 'schema_version'").fetchone()
    return {"status": "ok", "schema_version": row["value"] if row else None}
