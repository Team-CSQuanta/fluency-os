import { createWriteStream, existsSync, mkdirSync, renameSync, statSync, type WriteStream } from 'node:fs';
import path from 'node:path';
import { format } from 'node:util';
import { app } from 'electron';

// Never log the handshake token or any secret value through this module.

/** Also written to <user data>/logs/fluencyos.log.
 *
 * An installed app is started from a shortcut, not a terminal, so without a
 * file everything below — including the backend's own output and why it
 * failed to start — would go nowhere. Kept to one previous file: at 5MB the
 * current one becomes fluencyos.old.log at the next launch. */
const MAX_BYTES = 5 * 1024 * 1024;
let stream: WriteStream | null | undefined;

function file(): WriteStream | null {
  if (stream !== undefined) return stream;
  try {
    const dir = path.join(app.getPath('userData'), 'logs');
    mkdirSync(dir, { recursive: true });
    const current = path.join(dir, 'fluencyos.log');
    if (existsSync(current) && statSync(current).size > MAX_BYTES) {
      renameSync(current, path.join(dir, 'fluencyos.old.log'));
    }
    stream = createWriteStream(current, { flags: 'a' });
  } catch {
    stream = null;
  }
  return stream;
}

function write(level: string, args: unknown[]): void {
  file()?.write(`${new Date().toISOString()} ${level} ${format(...args)}\n`);
}

export const logger = {
  info: (...args: unknown[]) => {
    console.log('[fluencyos]', ...args);
    write('INFO', args);
  },
  warn: (...args: unknown[]) => {
    console.warn('[fluencyos]', ...args);
    write('WARN', args);
  },
  error: (...args: unknown[]) => {
    console.error('[fluencyos]', ...args);
    write('ERROR', args);
  },
};
