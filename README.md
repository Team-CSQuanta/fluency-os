# FluencyOS

An offline-first Electron desktop app for active English-language learning — see [`fluencyos_spec.md`](./fluencyos_spec.md) for the full product spec.

This repo currently implements **Increment 1**: the Electron + React shell, a FastAPI backend spawned as an authenticated child process, a WAL-mode SQLite database, and a working 5-step onboarding wizard.

## Prerequisites

| Tool | Version | Notes |
| --- | --- | --- |
| [Node.js](https://nodejs.org) | 20+ (tested on 22) | ships with `npm` |
| [uv](https://docs.astral.sh/uv/) | latest | manages the backend's Python 3.11 environment — install with `curl -LsSf https://astral.sh/uv/install.sh \| sh` |

You do **not** need Python 3.11 installed system-wide — `uv` downloads and pins it automatically inside `backend/`.

## First-time setup

From the repo root:

```bash
npm install                      # installs Electron, the renderer app, and dev tooling
uv sync --project backend        # provisions a Python 3.11 venv under backend/.venv
                                  # and installs fastapi, uvicorn, pydantic, pytest, httpx
```

Both commands are safe to re-run any time dependencies change.

## Running the app

```bash
npm run dev
```

This single command:
1. Starts the Vite dev server for the renderer (React UI) on `http://127.0.0.1:5173`.
2. Bundles the Electron main process and preload script with esbuild.
3. Launches the Electron window, which spawns the FastAPI backend as a child process on a free localhost port with a random per-launch handshake token, waits for it to report healthy, then loads the UI.

Press `Ctrl+C` in the terminal to stop everything (Vite, Electron, and the backend child process are all torn down together).

**Note:** only changes under `renderer/src/` hot-reload live. Changes under `electron/main/` or `electron/preload/` require stopping (`Ctrl+C`) and re-running `npm run dev`.

### Resetting onboarding / app data

The SQLite database and Electron's local storage live in the OS-standard user data directory:

- Linux: `~/.config/fluencyos/`
- macOS: `~/Library/Application Support/fluencyos/`
- Windows: `%APPDATA%\fluencyos\`

Delete `fluencyos.db` (and `fluencyos.db-wal` / `fluencyos.db-shm` if present) inside that folder to wipe all data and see the onboarding flow again from a clean slate.

## Running the backend standalone

Useful for API development without opening the Electron window:

```bash
cd backend
uv run python -m app.main --host 127.0.0.1 --port 8000 --token dev-token --db-path /tmp/fluencyos-dev.db
```

Then, for example:

```bash
curl -H "X-FluencyOS-Token: dev-token" http://127.0.0.1:8000/health
```

Every route requires the `X-FluencyOS-Token` header — this is the same handshake mechanism the Electron app uses automatically, so no other process on the machine can call the API.

## Tests

```bash
# Backend (FastAPI routes, migrations, schema)
cd backend && uv run pytest -q

# Type-checking (from repo root)
npx tsc -p renderer/tsconfig.json --noEmit
npx tsc -p electron/tsconfig.json --noEmit
```

## Building for production (partial)

```bash
npm run build            # builds the renderer (Vite) and Electron bundles (esbuild)
```

Packaging into a distributable installer (`electron-builder`) is not wired up yet — see [`fluencyos_spec.md`](./fluencyos_spec.md) §13 for the phased roadmap.

## Project layout

```
electron/     Electron main process + preload bridge (TypeScript)
renderer/     React + TypeScript + Tailwind + Zustand desktop UI (Vite)
backend/      FastAPI service (Python 3.11, managed by uv)
scripts/      Dev/build orchestration scripts (esbuild + wait-on)
claude-ui-mockup-files/   Visual reference mockup (not app code)
fluencyos_spec.md         Full product specification
```
