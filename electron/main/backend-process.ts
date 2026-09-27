import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { app } from 'electron';
import { generateHandshakeToken } from './handshake';
import { logger } from './logger';

export interface BackendHandle {
  baseUrl: string;
  token: string;
  process: ChildProcess;
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address && typeof address === 'object') {
        const { port } = address;
        server.close(() => resolve(port));
      } else {
        server.close();
        reject(new Error('Could not determine a free port'));
      }
    });
  });
}

async function waitForHealth(baseUrl: string, token: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  let lastError: unknown = null;
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/health`, { headers: { 'X-FluencyOS-Token': token } });
      if (res.ok) return;
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Backend did not become healthy in time: ${String(lastError)}`);
}

interface LaunchPlan {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** How long the first health check may take. */
  timeoutMs: number;
}

/** Development: the backend runs from the source tree through `uv run`,
 * exactly as before. */
function devLaunch(): LaunchPlan {
  const backendDir = path.join(app.getAppPath(), 'backend');
  return {
    command: 'uv',
    args: ['run', '--project', backendDir, 'python', '-m', 'app.main'],
    cwd: backendDir,
    env: process.env,
    // 30s, not 10s: `uv run` syncs new/updated deps on first launch after a
    // pull that changes pyproject.toml/uv.lock (e.g. pymupdf+lxml, ~30MB), and
    // that download+build can outlast a short health-check window.
    timeoutMs: 30_000,
  };
}

/** An installed app: the portable Python that scripts/build-backend-runtime.mjs
 * put in resources/backend-runtime, with every dependency already inside it.
 * Nothing on the user's machine is needed — no Python, no uv, no network. */
function packagedLaunch(): LaunchPlan {
  const runtime = path.join(process.resourcesPath, 'backend-runtime');
  const python =
    process.platform === 'win32'
      ? path.join(runtime, 'python', 'python.exe')
      : path.join(runtime, 'python', 'bin', 'python3');
  if (!existsSync(python)) {
    throw new Error(`The bundled backend is missing (${python}). Reinstall FluencyOS.`);
  }
  const backendDir = path.join(runtime, 'backend');
  return {
    command: python,
    args: ['-m', 'app.main'],
    cwd: backendDir,
    env: {
      ...process.env,
      PYTHONPATH: backendDir,
      // Only what shipped: a user's own Python packages must not leak in.
      PYTHONNOUSERSITE: '1',
      // The install folder is read-only; the bytecode was compiled at build time.
      PYTHONDONTWRITEBYTECODE: '1',
      PYTHONUNBUFFERED: '1',
      PYTHONIOENCODING: 'utf-8',
      FLUENCYOS_FFMPEG_DIR: path.join(runtime, 'ffmpeg', 'bin'),
    },
    // A cold start on a slow disk loads a lot of compiled libraries.
    timeoutMs: 90_000,
  };
}

export async function startBackend(): Promise<BackendHandle> {
  const port = await getFreePort();
  const token = generateHandshakeToken();
  const dbPath = path.join(app.getPath('userData'), 'fluencyos.db');
  const plan = app.isPackaged ? packagedLaunch() : devLaunch();

  logger.info(`starting backend on port ${port}, db at ${dbPath} (${app.isPackaged ? 'bundled' : 'uv run'})`);

  const child = spawn(
    plan.command,
    [
      ...plan.args,
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--token',
      token,
      '--db-path',
      dbPath,
    ],
    { cwd: plan.cwd, env: plan.env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
  );

  child.stdout?.on('data', (chunk: Buffer) => logger.info('[backend]', chunk.toString().trim()));
  child.stderr?.on('data', (chunk: Buffer) => logger.warn('[backend:err]', chunk.toString().trim()));
  child.on('exit', (code, signal) => logger.warn(`backend process exited (code=${code}, signal=${signal})`));
  child.on('error', (err) => logger.error('failed to spawn backend process', err));

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForHealth(baseUrl, token, plan.timeoutMs);
  logger.info('backend is healthy');

  return { baseUrl, token, process: child };
}

export function stopBackend(handle: BackendHandle | null): void {
  if (!handle) return;
  const { pid } = handle.process;
  // Windows has no SIGTERM: kill() is an immediate TerminateProcess of the
  // backend alone, which would leave its own children (the GPU model server)
  // running after the app has closed. taskkill /T takes the whole tree.
  if (process.platform === 'win32' && pid !== undefined) {
    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true });
    return;
  }
  handle.process.kill('SIGTERM');
  setTimeout(() => {
    if (!handle.process.killed) {
      handle.process.kill('SIGKILL');
    }
  }, 3000);
}
