from fastapi import Header, HTTPException, status

from app.config import settings


async def require_token(x_fluencyos_token: str | None = Header(default=None)) -> None:
    """Every route depends on this, including /health, per the spec's handshake model:
    no other process on the machine can call the API without this per-launch token.
    """
    if not settings.token or x_fluencyos_token != settings.token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or missing handshake token")


async def require_token_or_query(
    x_fluencyos_token: str | None = Header(default=None),
    t: str | None = None,
) -> None:
    """Same handshake, but the token may arrive as `?t=` instead of a header.

    Needed only where the *browser* fetches the URL rather than our own code:
    a <video src> cannot carry a custom header, and the alternative — reading
    the whole file into a blob so fetch() can set one — would mean loading a
    multi-gigabyte film into renderer memory and losing seeking entirely.

    The exposure this adds is the token appearing in a URL inside a process
    that already holds the token. Nothing leaves the machine: the server is
    bound to 127.0.0.1, and the renderer sets no referrer to any other origin.
    """
    supplied = x_fluencyos_token or t
    if not settings.token or supplied != settings.token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or missing handshake token")
