# FluencyOS

An offline-first desktop application for active English learning: meet a word in
real media, understand it in that exact context, keep it with the clip or page it
came from, review it, and use it in conversation.

Three parts run together:

| Part | What it is | Lives in |
| --- | --- | --- |
| Renderer | React + Vite UI | `renderer/` |
| Desktop shell | Electron main process | `electron/` |
| Backend | FastAPI + SQLite, spawned by the shell | `backend/` |

Everything runs on your own machine. The backend binds to `127.0.0.1` on a free
port chosen at launch, and the shell hands the UI a per-launch token, so no other
process on the machine can call the API.

## What you need

- **Node.js 20 or newer** — developed on 22.19, with npm 10.
- **[uv](https://docs.astral.sh/uv/)** — runs the Python backend. The shell
  launches the backend with `uv run`, so uv has to be on your `PATH`.
  You do not need to install Python yourself: the backend asks for 3.11 and uv
  fetches a matching one if you have not got it.
- **ffmpeg** — optional, and only for the video side. Without it the app runs and
  the reading, vocabulary, review and conversation features work; importing
  video, generating clips and probing media do not. Install it from your package
  manager, or point `FLUENCYOS_FFMPEG_DIR` at a folder containing `ffmpeg` and
  `ffprobe`.

Local AI models are **not** part of setup. They are downloaded from inside the
app, under Settings → AI, once it is running.

## Setup

```bash
git clone <this repository>
cd fluency-os

npm install                 # renderer included — it is an npm workspace
cd backend && uv sync       # creates backend/.venv from uv.lock
cd ..
```

`uv sync` is the long step. It installs PyTorch (CPU build), llama-cpp-python and
faster-whisper — roughly a gigabyte once unpacked. The CPU index is pinned in
`backend/pyproject.toml`, so you do not need to pass `--extra-index-url`; without
that pin uv would resolve the CUDA build and pull about 3 GB of GPU packages
nothing here would load.

## Running it

```bash
npm run dev
```

That starts Vite on `http://127.0.0.1:5173`, builds the Electron main process,
and opens the app. Electron then spawns the backend itself — there is no separate
command for it, and no port or token to configure.

The first launch opens onboarding: a name, your languages, a short placement
test. After that the app opens on the dashboard.

To run the backend on its own — useful when you want to read its logs or poke at
the API directly:

```bash
cd backend
uv run python -m app.main --host 127.0.0.1 --port 8000 --token dev-token
```

Every route needs the token, as a header:

```bash
curl -H "X-FluencyOS-Token: dev-token" http://127.0.0.1:8000/health
```

## Tests and checks

```bash
npm run test:backend                        # 855 tests, about 9 minutes
cd backend && uv run pytest tests/test_forest.py -q   # one file, seconds

npx tsc -p renderer/tsconfig.json --noEmit  # typecheck the UI
npm run build:renderer                      # typecheck and bundle it
```

There is no renderer test runner in the repo; the UI is covered by typechecking
and by the backend tests behind it.

## Building

```bash
npm run build     # bundles the renderer and the Electron main process
npx electron .    # runs what was built
```

`electron-builder` is installed but not yet wired to a script, so there is no
packaged installer target at the moment.

## Where your data lives

Everything — the SQLite database, imported book files, rendered page images,
saved clips, downloaded models and profile pictures — sits in Electron's user
data folder:

| OS | Path |
| --- | --- |
| Linux | `~/.config/fluencyos` |
| macOS | `~/Library/Application Support/fluencyos` |
| Windows | `%APPDATA%\fluencyos` |

Your own video and book files are never copied or moved; the app reads them where
you keep them and stores only a path.

Deleting that folder resets the application completely. The settings screen shows
the exact path under Account → Where your data lives.

## Layout

```
backend/app/routers/     HTTP surface, one module per area
backend/app/services/    the actual logic — leveling, review scheduling, media
backend/app/migrations/  numbered .sql files, run in order at startup
backend/tests/           pytest, one file per area
electron/main/           window, backend process, IPC, file dialogs
renderer/src/features/   one folder per screen
renderer/src/store/      zustand stores, one per area
fluencyos_spec.md        the specification the implementation follows
```

## If something goes wrong

**`failed to spawn backend process`** — uv is not on the `PATH` Electron
inherited. Check with `uv --version` in the same shell you run `npm run dev`
from.

**The first launch hangs for a while** — `uv run` syncs the Python environment
before the backend starts. It is only slow the first time, or after a pull that
changes `pyproject.toml` or `uv.lock`.

**Video import fails but everything else works** — ffmpeg is missing. See above.

**The AI features say the model is not running** — no model has been downloaded
yet. Settings → AI lists what is available and downloads it.
