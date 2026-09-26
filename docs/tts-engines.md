# Voice engines: Kokoro and Pocket TTS

FluencyOS can speak with either of two local text-to-speech engines. This
note records why there are two, what actually differs, and how to choose.

## The problem the second engine addresses

Conversation latency was measured end to end on the reference machine (Ryzen 3
3200G — 4 cores, Zen+, AVX2, **no AVX-512/VNNI** — 6GB RAM). After the Kokoro
fp16 work, the budget to first audio looked like this:

| Stage | Time |
| --- | --- |
| VAD confirmation window | 0.40s |
| HTTP upload | ~0.10s |
| Speech-to-text (whisper tiny.en) | 0.75s |
| LLM (gemma-3-1b) | 1.10s |
| **TTS, first chunk (Kokoro fp16)** | **0.84s** |
| Total | ~3.2s |

Four separate attempts to cut this were measured and **all came back at or
near zero**: prompt trimming (llama.cpp already reuses the KV prefix cache),
LLM streaming (0.15s), STT `vad_filter`/`beam_size` tuning (within noise), and
shortening the system prompt (90 chars vs 723 chars — no measurable
difference). There is no dominant term left to attack by scheduling.

What remains is structural. **Kokoro cannot emit any audio until an entire
chunk has been synthesized.** That is the floor under its 0.84s, and it is the
only reason `tts_engine.split_for_streaming` splits a reply in two at all —
the split buys an earlier first sound at the cost of a second call's fixed
overhead.

Pocket TTS is autoregressive and yields audio frames while it is still
generating, so its first sound does not wait on the rest of the sentence. That
is a different shape of cost, not a faster version of the same one.

## What each engine is

| | Kokoro | Pocket TTS |
| --- | --- | --- |
| Source | `kokoro-onnx`, fp16 ONNX | Kyutai `pocket-tts` |
| Runtime | onnxruntime | PyTorch (~1GB installed) |
| Download | ~243MB (model + voices) | ~225MB (weights + tokenizer + one voice) |
| Emission | one whole chunk at a time | streams frames as generated |
| Reply splitting | two chunks | two chunks (see below) |
| Licence | Apache-2.0 | MIT |
| Role | fallback | **default** |

Pocket TTS is the default and what the app speaks with. Kokoro is kept as a
selectable fallback rather than deleted: it needs no PyTorch and far less
memory, so on a machine where Pocket TTS will not load it is the difference
between a slower voice and no voice at all.

## Measured on the reference machine

Both engines in one run, same replies, same conditions — mean time to first
audible chunk, which is what a learner actually waits for:

| | mean first audio | RTF |
| --- | --- | --- |
| Kokoro | 2.22s | 1.01x – 1.25x |
| **Pocket TTS** | **1.03s** | **0.52x – 0.55x** |
| Cold load | Kokoro 2.14s | Pocket 10.85s |

Two things to read off this. Pocket TTS is roughly **2.2x faster to first
audio**. And Kokoro's RTF drifts *above* real time (1.01x–1.25x), meaning
speech is produced more slowly than it plays and replies can develop gaps;
Pocket TTS held 0.52x–0.55x across every reply.

Pocket TTS reaches its first audio **frame** in ~0.25s, which essentially
matches Kyutai's published ~200ms on an M4 — on a CPU with no AVX-512/VNNI.
That number is not reachable through the current file-based audio endpoint;
it is what end-to-end audio streaming would be worth.

### Why both engines split replies, including the streaming one

The obvious-looking rule — "Pocket TTS streams, so it needs no split" — was
measured and is **wrong**, for a reason that has nothing to do with the
engine. `ensure_audio_chunk` synthesizes a chunk to a complete WAV file and
only then serves it, so the learner waits for the whole of chunk 0 and an
engine's internal time-to-first-frame never reaches them:

| Pocket TTS, one chunk per reply | 2.05s |
| --- | --- |
| **Pocket TTS, split like Kokoro** | **1.09s** |

So the split is a property of how audio is served, not of either engine, and
it lives in `reply_chunking.py` shared by both. If audio is ever streamed end
to end, that stops being true for Pocket TTS — and only then.

## Installing

`pocket-tts` is a normal dependency — it is the default engine, so it cannot
sit behind an extra. It brings PyTorch with it: ~260MB to download, ~1GB
installed, which is the real cost of this choice.

```bash
cd backend
uv sync
```

### torch must come from the CPU index

This has three parts and all of them are load-bearing. Get one wrong and the
app stops launching.

```toml
dependencies = [
    "pocket-tts>=3.1.0",
    "torch>=2.5",          # (2) direct, not just transitive
]

[[tool.uv.index]]
name = "pytorch-cpu"
url = "https://download.pytorch.org/whl/cpu"
explicit = true

[tool.uv.sources]
torch = { index = "pytorch-cpu" }   # (1) pin in the file, not on the CLI
```

**(1) In `pyproject.toml`, not a `--extra-index-url` flag.** The app launches
the backend with `uv run --project backend ...` (see
`electron/main/backend-process.ts`), which re-syncs from `pyproject.toml`
every time. A flag helps only the single command that carries it; the very
next `uv run` undoes it.

**(2) `torch` declared directly, even though `pocket-tts` already pulls it.**
uv applies `[tool.uv.sources]` to the project's *own* dependencies, not to
transitive ones. Without that line the pin silently does nothing and torch
resolves from PyPI as the CUDA build — a 554MB wheel plus `cuda-toolkit`,
`nvidia-cudnn-cu13`, `nvidia-nccl-cu13`, `triton` and friends.

**(3) `uv.lock` must be committed in sync with it.** The lockfile records
which index each package came from. Check with:

```bash
grep -A2 '^name = "torch"$' backend/uv.lock
# want: source = { registry = "https://download.pytorch.org/whl/cpu" }
```

If that line says `pypi.org/simple`, run `uv lock --upgrade-package torch`.

**The failure this produces is not obvious.** `uv run` blocks trying to fetch
gigabytes of CUDA wheels, the backend never binds its port, and Electron
reports only `Backend did not become healthy in time: TypeError: fetch
failed` after its 30s timeout — with no mention of torch, uv, or downloads.

The model itself is downloaded from **Settings → Models**. If the package is
somehow missing from an install, Settings greys the option out with the reason
and the API refuses to select it, rather than leaving a setting that looks
applied and a conversation that is silent.

## Where the model comes from

The weights are fetched from `kyutai/pocket-tts-without-voice-cloning`, **not**
`kyutai/pocket-tts`. The latter is a gated repo: it answers HTTP 401 without an
accepted licence and an HF login, which a local-first desktop app has no way to
ask for in the middle of a download. The mirror is public and drops only voice
cloning, which this app does not use — all 26 preset voices are present.

Three specific files are downloaded, not a repo snapshot; the full repo carries
every language and both model sizes and is ~11.7GB:

- `languages/english_2026-04/model.safetensors` — 219MB, the 100M-parameter model
- `languages/english_2026-04/tokenizer.model` — 59KB
- `languages/english_2026-04/embeddings/alba.safetensors` — 6.2MB, one voice

They are fetched by the app's own `download_manager` over plain HTTP rather
than through `hf_hub_download`. This is deliberate and matches the existing
`HF_HUB_DISABLE_XET` workaround in `model_manager.py`: `hf_hub_download` was
observed stalling at **0 bytes** on the 219MB file on this machine.

The `_24l` variants are the same family at 24 layers and ~1.3GB. They are not
offered — they are out of reach of the hardware tier this app targets.

## Caveats worth knowing before switching

**Memory and cold start.** Pocket TTS wants a few hundred MB more resident
than Kokoro, on top of PyTorch's own footprint, and loads in **10.85s against
Kokoro's 2.14s**. That is a one-time cost per session, paid at Launch AI, not
per reply. Selecting an engine unloads the other — on a machine where this
tradeoff is interesting at all, holding both voices is what pushes it into
swap.

**If Pocket TTS will not load** (too little free RAM, a broken install),
switch to Kokoro in Settings. That is what it is still there for.

**No int8 shortcut.** `pocket_tts` ships `apply_dynamic_int8` (FBGEMM),
advertised at "+27% on x86". Treat that as unverified here. This codebase has
one hard measurement on the subject: int8 Kokoro on this CPU ran at RTF 2.97x
against fp16's 0.56x — **4.6x slower**, because int8 matmuls need VNNI and
Zen+ does not have it. Benchmark before assuming int8 helps.

**Contention.** Kokoro measured RTF 0.56x idle and **2.9x under CPU load** —
a 5x collapse. Both engines are on four shared cores, so any throughput
figure taken on an idle machine overstates what a real turn gets.

**Concurrency.** Kokoro's ONNX inference is thread-safe, and `tts_engine`
deliberately holds its lock for loading only so two sentences can synthesize
at once (measured 1.45x). `generate_audio_stream` is documented as **not**
thread-safe, so `pocket_tts_engine` holds its lock across generation instead.
Do not "optimise" that lock away.

## Implementation notes

- `app/services/voice/tts.py` is the dispatcher and the only module that knows
  which engine a user has chosen. Both engines satisfy the same five-function
  interface, so everything upstream is engine-agnostic.
- Cached audio chunk files are named `{turn_id}.{engine}.{index}.wav`. The
  engine belongs in the filename because the two disagree about what "chunk 0"
  contains — Kokoro's is the first sentence, Pocket TTS's is the whole reply.
  Sharing one name would serve half a reply as if it were all of it.
- `engine_status.status()` answers two different questions and the difference
  matters. With no engine named it reports *what is occupying RAM* (either
  engine counts) — what the global AI indicator wants. With one named it
  reports whether *that* engine is loaded — what the turn path must ask, or
  selecting Pocket TTS while Kokoro is resident would pass the launch check
  and then stall the first turn on a multi-second load.
