from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import configure_from_argv, settings
from app.db import get_connection
from app.migrations.runner import run_migrations
from app.routers import hardware, health, placement, users

configure_from_argv()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    conn = get_connection()
    try:
        run_migrations(conn)
    finally:
        conn.close()
    yield


app = FastAPI(title="FluencyOS Backend", lifespan=lifespan)

# Local-only: renderer talks to us over 127.0.0.1 in dev via the Vite server origin.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(users.router)
app.include_router(placement.router)
app.include_router(hardware.router)


def main() -> None:
    import uvicorn

    uvicorn.run(app, host=settings.host, port=settings.port, log_level="info")


if __name__ == "__main__":
    main()
