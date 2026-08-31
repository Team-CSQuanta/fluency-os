from fastapi import Header, HTTPException, status

from app.config import settings


async def require_token(x_fluencyos_token: str | None = Header(default=None)) -> None:
    """Every route depends on this, including /health, per the spec's handshake model:
    no other process on the machine can call the API without this per-launch token.
    """
    if not settings.token or x_fluencyos_token != settings.token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or missing handshake token")
