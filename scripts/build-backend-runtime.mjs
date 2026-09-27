#!/usr/bin/env node
// Builds the self-contained backend that ships inside the installer:
//
//   build/backend-runtime/
//     python/    a portable CPython 3.11 with every backend dependency
//                installed into it, exactly as pinned in backend/uv.lock
//     backend/   the backend's own code (app/)
//     ffmpeg/    ffmpeg + ffprobe, for Learn by watching
//
// An installed FluencyOS therefore needs no Python, no uv, no compiler and no
// internet to start. Development is unchanged: `npm run dev` still runs the
// backend through `uv run`.
//
// It builds for the machine it runs on. The dependencies include compiled
// code (PyTorch, llama-cpp-python, ctranslate2, onnxruntime), so a Windows
// runtime has to be built on Windows and a Linux one on Linux —
// .github/workflows/release.yml does both.

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backend = path.join(root, 'backend');
const out = path.join(root, 'build', 'backend-runtime');
const work = path.join(root, 'build', '.runtime-work');
const cache = path.join(root, 'build', '.cache');
const isWindows = process.platform === 'win32';

// The stable 8.1 branch, LGPL, shared libraries: LGPL so it can be
// redistributed alongside the app, shared because the static builds carry
// every library twice (once in ffmpeg, once in ffprobe) at twice the size.
const FFMPEG = {
  linux: 'ffmpeg-n8.1-latest-linux64-lgpl-shared-8.1.tar.xz',
  win32: 'ffmpeg-n8.1-latest-win64-lgpl-shared-8.1.zip',
};
const FFMPEG_BASE = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest';

// Pieces of PyTorch only needed to compile against it. ~100MB nobody loads.
const PRUNE = ['torch/include', 'torch/share', 'torch/bin/protoc', 'torch/bin/protoc.exe'];

function step(title) {
  console.log(`\n── ${title}`);
}

function run(cmd, args, opts = {}) {
  console.log(`$ ${cmd} ${args.join(' ')}`);
  // No shell: every tool here is a real executable, and a shell would split
  // paths that contain spaces.
  const res = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (res.error) throw res.error;
  if (res.status !== 0 && !opts.allowFailure) throw new Error(`${cmd} exited with ${res.status}`);
  return res.status;
}

function sizeOf(dir) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    total += entry.isDirectory() ? sizeOf(p) : statSync(p).size;
  }
  return total;
}
const mb = (bytes) => `${Math.round(bytes / 1e6)} MB`;

if (!['linux', 'win32'].includes(process.platform)) {
  console.warn(`Note: ${process.platform} is not a target the release workflow builds; continuing anyway.`);
}

rmSync(out, { recursive: true, force: true });
rmSync(work, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
mkdirSync(work, { recursive: true });
mkdirSync(cache, { recursive: true });

// ── 1. Portable Python ───────────────────────────────────────────────────────
// uv's managed interpreters are python-build-standalone builds, which are
// relocatable by design — they run from wherever they are unpacked.
step('Portable Python 3.11');
const pyHome = path.join(out, 'python');
// uv names its builds like cpython-3.11.15-linux-x86_64-gnu or
// cpython-3.11.15-windows-x86_64-none; the minor-version aliases next to them
// are links, not builds.
const osTag = { linux: 'linux', win32: 'windows', darwin: 'macos' }[process.platform];
const archTag = { x64: 'x86_64', arm64: 'aarch64' }[process.arch];
const pyBuild = (dir) =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((name) => name.startsWith('cpython-3.11.') && name.includes(`-${osTag}-${archTag}-`))
        .filter((name) => !lstatSync(path.join(dir, name)).isSymbolicLink())
        .sort((a, b) => Number(b.split('.')[2].split('-')[0]) - Number(a.split('.')[2].split('-')[0]))[0]
    : undefined;
// A build uv already installed on this machine is the same download, so it
// is copied rather than fetched again. CI has none and downloads it.
const uvPythons = spawnSync('uv', ['python', 'dir'], { encoding: 'utf8' }).stdout?.trim();
let pySource = uvPythons && pyBuild(uvPythons) ? path.join(uvPythons, pyBuild(uvPythons)) : undefined;
if (pySource) {
  console.log(`  reusing ${pySource}`);
} else {
  const pyDownloads = path.join(work, 'python-download');
  run('uv', ['python', 'install', '3.11', '--install-dir', pyDownloads, '--no-bin']);
  const name = pyBuild(pyDownloads);
  if (!name) throw new Error('uv did not install a CPython 3.11 build');
  pySource = path.join(pyDownloads, name);
}
cpSync(pySource, pyHome, { recursive: true, verbatimSymlinks: true });
const python = isWindows ? path.join(pyHome, 'python.exe') : path.join(pyHome, 'bin', 'python3');
const sitePackages = isWindows
  ? path.join(pyHome, 'Lib', 'site-packages')
  : path.join(pyHome, 'lib', 'python3.11', 'site-packages');
// Marks the interpreter as managed by uv; it is ours now.
rmSync(path.join(path.dirname(sitePackages), 'EXTERNALLY-MANAGED'), { force: true });

// ── 2. Dependencies, exactly as locked ───────────────────────────────────────
// Synced into a scratch virtualenv (so uv honours uv.lock and its package
// indexes, including the CPU-only PyTorch one), then moved into the portable
// interpreter's own site-packages. A virtualenv itself cannot ship: it
// records the absolute path of the interpreter it was made from.
step('Backend dependencies (from backend/uv.lock)');
const venv = path.join(work, 'venv');
run('uv', ['sync', '--frozen', '--no-dev', '--no-install-project', '--python', python], {
  cwd: backend,
  env: { ...process.env, UV_PROJECT_ENVIRONMENT: venv },
});
const venvSite = isWindows ? path.join(venv, 'Lib', 'site-packages') : path.join(venv, 'lib', 'python3.11', 'site-packages');
cpSync(venvSite, sitePackages, { recursive: true, force: true, verbatimSymlinks: true });
for (const helper of ['_virtualenv.py', '_virtualenv.pth']) rmSync(path.join(sitePackages, helper), { force: true });
for (const rel of PRUNE) rmSync(path.join(sitePackages, rel), { recursive: true, force: true });

// PyTorch and ctranslate2 need the Visual C++ runtime, which a fresh Windows
// install may not have. Microsoft allows these DLLs to ship next to the
// program that uses them, and Windows looks beside python.exe first.
if (isWindows) {
  step('Visual C++ runtime (app-local)');
  const system32 = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32');
  for (const dll of readdirSync(system32)) {
    if (/^(msvcp140(_\d|_codecvt_ids)?|vcruntime140(_1)?|concrt140|vcomp140)\.dll$/i.test(dll)) {
      const dest = path.join(pyHome, dll);
      if (!existsSync(dest)) cpSync(path.join(system32, dll), dest);
      console.log(`  ${dll}`);
    }
  }
}

// ── 3. The backend's own code ────────────────────────────────────────────────
step('Backend code');
cpSync(path.join(backend, 'app'), path.join(out, 'backend', 'app'), {
  recursive: true,
  filter: (src) => !src.includes('__pycache__') && !src.endsWith('.pyc'),
});

// ── 4. Bytecode ──────────────────────────────────────────────────────────────
// An installed app's folder is read-only (Program Files, a mounted
// AppImage), so Python cannot cache bytecode there and would recompile
// PyTorch's thousands of modules on every launch. Compiled once here instead,
// as unchecked-hash .pyc files: valid regardless of file timestamps, which
// installers do not reliably preserve. Some packages ship deliberately
// invalid Python (test fixtures, templates); those are skipped, not fatal.
step('Precompiling bytecode');
run(python, ['-m', 'compileall', '-q', '-j', '0', '--invalidation-mode', 'unchecked-hash', pyHome, path.join(out, 'backend')], {
  allowFailure: true,
  stdio: ['ignore', 'ignore', 'inherit'],
});

// ── 5. ffmpeg ────────────────────────────────────────────────────────────────
step('ffmpeg');
const asset = FFMPEG[process.platform];
if (!asset) {
  console.warn('  no bundled ffmpeg for this platform; Learn by watching will use one on PATH');
} else {
  const archive = path.join(cache, asset);
  if (!existsSync(archive)) run('curl', ['-fsSL', '--retry', '4', '-o', archive, `${FFMPEG_BASE}/${asset}`]);
  const unpacked = path.join(work, 'ffmpeg');
  mkdirSync(unpacked, { recursive: true });
  // Windows' own tar (bsdtar) reads .zip; the GNU tar that Git puts on PATH
  // does not, so it is named explicitly.
  const tar = isWindows ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  run(tar, ['-xf', archive, '-C', unpacked]);
  const top = path.join(unpacked, readdirSync(unpacked)[0]);
  const dest = path.join(out, 'ffmpeg');
  // ffplay is a media player — nothing here uses it.
  cpSync(path.join(top, 'bin'), path.join(dest, 'bin'), {
    recursive: true,
    filter: (src) => !/ffplay(\.exe)?$/i.test(src),
  });
  // Linux builds find their libraries through an rpath of $ORIGIN/../lib.
  if (!isWindows) cpSync(path.join(top, 'lib'), path.join(dest, 'lib'), { recursive: true, verbatimSymlinks: true });
  cpSync(path.join(top, 'LICENSE.txt'), path.join(dest, 'LICENSE.txt'));
  writeFileSync(
    path.join(dest, 'SOURCE.txt'),
    `FFmpeg ${asset}, LGPL build from https://github.com/BtbN/FFmpeg-Builds (source: https://ffmpeg.org/download.html).\n`,
  );
}

// ── 6. Check it runs, from where it now lives ────────────────────────────────
step('Smoke test');
run(
  python,
  [
    '-c',
    [
      'import sys, app.main, torch, llama_cpp, faster_whisper, kokoro_onnx, pocket_tts, fitz',
      'print("python", sys.version.split()[0], "| torch", torch.__version__, "| backend imports OK")',
    ].join('; '),
  ],
  { cwd: path.join(out, 'backend'), env: { ...process.env, PYTHONNOUSERSITE: '1', PYTHONPATH: path.join(out, 'backend') } },
);

const version = spawnSync(python, ['-c', 'import sys; print(sys.version.split()[0])'], { encoding: 'utf8' }).stdout.trim();
const commit = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
writeFileSync(
  path.join(out, 'manifest.json'),
  JSON.stringify({ python: version, platform: process.platform, arch: process.arch, commit, builtAt: new Date().toISOString(), ffmpeg: asset ?? null }, null, 2),
);

rmSync(work, { recursive: true, force: true });
console.log(`\nBackend runtime ready: ${out} (${mb(sizeOf(out))})`);
