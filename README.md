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

### Running local models on the GPU

Settings → AI → *Where local AI runs* chooses **Auto**, **GPU** or **CPU** for
every local model. Nothing extra needs installing for it:

- **Chat model.** In Auto or GPU mode the app downloads llama.cpp's prebuilt
  server for this machine (12–33 MB, once) into the models folder and runs the
  model through it: Vulkan on Windows and Linux (NVIDIA, AMD and Intel,
  integrated graphics included), Metal on Apple Silicon. If that cannot start
  — no GPU, no build for the platform, offline — it falls back to the CPU and
  Settings says why.
- **Speech to text** uses the GPU only on NVIDIA (CUDA); otherwise the CPU.
- **Kokoro voice** uses whatever GPU backend the installed ONNX Runtime offers
  (Core ML on Macs; DirectML or CUDA with those builds), otherwise the CPU.
- **Pocket TTS voice** always runs on the CPU, as it is designed to.

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

[![Tests](https://github.com/Team-CSQuanta/fluency-os/actions/workflows/tests.yml/badge.svg)](https://github.com/Team-CSQuanta/fluency-os/actions/workflows/tests.yml)

To show how the app is tested, start with the beginner tests — 15 short,
commented tests in three kinds (plain functions, the backend API, frontend
logic), about 3 seconds to run. `docs/beginner-testing.md` walks through them.

```bash
npm run test:beginner        # the 15 beginner tests, each printed by name
```

One command runs every check and writes a report:

```bash
npm test                     # everything, about 3 minutes on 4 cores
npm test -- --verbose        # print each test's name as it runs
npm test -- --open           # open the report in the browser afterwards
```

It runs three checks, and the report at `test-reports/index.html` lists every
test by name under the feature it covers, with backend line coverage
(`test-reports/coverage/index.html` has it line by line):

| Check | Tool | What it covers |
| --- | --- | --- |
| Type-check | `tsc --noEmit` | the whole renderer: every screen, store and test |
| Frontend unit tests | Vitest | renderer logic kept free of React: hands-free turn detection, word highlighting, subtitle selection, PDF sentences, contents, error messages |
| Backend tests | pytest, parallel | the real API, migrations, file parsers and scheduling against temporary data; AI models are stubbed, so no downloads are needed |

The media tests run real video through ffmpeg and are skipped if it is not
installed. GitHub Actions runs `npm test` on every push and pull request
(`.github/workflows/tests.yml`); each run's summary is on its Actions page, with
the full report attached as the `test-report` artifact.

Smaller runs while working:

```bash
npm run test:frontend                                  # Vitest only, ~2 seconds
npm run test:backend                                   # pytest only, parallel
cd backend && uv run pytest tests/test_forest.py -q    # one file
cd renderer && npx vitest                              # re-run on every save
```

## Building

```bash
npm run build     # bundles the renderer and the Electron main process
npx electron .    # runs what was built
```

### Installers for Windows and Linux

```bash
npm run dist      # installers for the OS you run it on, into release/
```

| Platform | Files | Install |
| --- | --- | --- |
| Windows 10/11 (x64) | `FluencyOS-<version>-win-x64.exe` | run it; a setup wizard installs it with Start-menu and desktop shortcuts |
| Linux (x64) | `FluencyOS-<version>-linux-amd64.deb` | `sudo apt install ./FluencyOS-*.deb` (Ubuntu, Debian, Mint…) |
| Linux (x64) | `FluencyOS-<version>-linux-x86_64.AppImage` | `chmod +x` it and run it; no install, any distribution |

An installed FluencyOS needs nothing else on the computer — no Python, no uv,
no ffmpeg. `npm run dist` first builds `build/backend-runtime/`
(`scripts/build-backend-runtime.mjs`): a portable Python 3.11 with every
backend dependency installed from `backend/uv.lock`, the backend's code
precompiled, and an LGPL build of ffmpeg. Electron starts that bundled Python
when packaged, and still uses `uv run` in development.

Each installer has to be built on its own OS, because the backend contains
compiled code (PyTorch, llama.cpp, ctranslate2). To get both without a
Windows machine, use GitHub Actions: **Actions → Build installers → Run
workflow** builds both and attaches them to the run, and pushing a tag such as
`v0.1.0` also publishes them as a GitHub Release
(`.github/workflows/release.yml`).

Worth knowing:

- The installers are about 0.6–0.8 GB, most of it PyTorch. AI models are not
  included; they are downloaded from Settings → AI as before.
- They are not code-signed. Windows SmartScreen will say "Windows protected
  your PC" — choose **More info → Run anyway**. Signing needs a paid
  certificate.
- On Ubuntu 24.04 and later, prefer the `.deb`. The AppImage works there too,
  but has to run without Chromium's sandbox, because the OS restricts what an
  AppImage may use for it; a small launcher (`scripts/after-pack.cjs`) adds
  `--no-sandbox` in exactly that case. The `.deb` keeps the sandbox by
  installing Chromium's helper setuid (`build/linux/after-install.sh`).
- If the app opens but says it cannot reach its backend, the reason is in
  `logs/fluencyos.log` inside the data folder below.
- Uninstalling keeps your library, vocabulary and downloaded models; they are
  in the app-data folder listed below.
- `npm run dist:reuse-runtime` repackages without rebuilding the backend
  runtime, when only the interface or Electron code changed.

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
