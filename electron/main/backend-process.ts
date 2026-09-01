import { spawn, type ChildProcess } from 'node:child_process';
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

// 30s, not 10s: `uv run` syncs new/updated deps on first launch after a
// pull that changes pyproject.toml/uv.lock (e.g. pymupdf+lxml, ~30MB), and
// that download+build can outlast a short health-check window.
async function waitForHealth(baseUrl: string, token: string, timeoutMs = 30_000): Promise<void> {
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

function resolveBackendDir(): string {
  // Dev: project root is the Electron app path. Packaged builds will need
  // an extraResources-based path here — deliberately out of scope for this increment.
  return path.join(app.getAppPath(), 'backend');
}

export async function startBackend(): Promise<BackendHandle> {
  const port = await getFreePort();
  const token = generateHandshakeToken();
  const dbPath = path.join(app.getPath('userData'), 'fluencyos.db');
  const backendDir = resolveBackendDir();

  logger.info(`starting backend on port ${port}, db at ${dbPath}`);

  const child = spawn(
    'uv',
    [
      'run',
      '--project',
      backendDir,
      'python',
      '-m',
      'app.main',
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--token',
      token,
      '--db-path',
      dbPath,
    ],
    { cwd: backendDir, stdio: ['ignore', 'pipe', 'pipe'] },
  );

  child.stdout?.on('data', (chunk: Buffer) => logger.info('[backend]', chunk.toString().trim()));
  child.stderr?.on('data', (chunk: Buffer) => logger.warn('[backend:err]', chunk.toString().trim()));
  child.on('exit', (code, signal) => logger.warn(`backend process exited (code=${code}, signal=${signal})`));
  child.on('error', (err) => logger.error('failed to spawn backend process', err));

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForHealth(baseUrl, token);
  logger.info('backend is healthy');

  return { baseUrl, token, process: child };
}

export function stopBackend(handle: BackendHandle | null): void {
  if (!handle) return;
  handle.process.kill('SIGTERM');
  setTimeout(() => {
    if (!handle.process.killed) {
      handle.process.kill('SIGKILL');
    }
  }, 3000);
}
