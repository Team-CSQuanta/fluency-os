import argparse
import sys
from dataclasses import dataclass


@dataclass
class Settings:
    host: str = "127.0.0.1"
    port: int = 8000
    token: str = ""
    db_path: str = "fluencyos.db"


settings = Settings()


def configure_from_argv() -> Settings:
    """Parse CLI flags passed by the Electron main process (see backend-process.ts).

    Uses parse_known_args so this also works fine under `pytest` or any other
    entry point that doesn't pass these flags.
    """
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default=settings.host)
    parser.add_argument("--port", type=int, default=settings.port)
    parser.add_argument("--token", default=settings.token)
    parser.add_argument("--db-path", default=settings.db_path)
    args, _unknown = parser.parse_known_args(sys.argv[1:])

    settings.host = args.host
    settings.port = args.port
    settings.token = args.token
    settings.db_path = args.db_path
    return settings
