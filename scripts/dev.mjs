import { spawn } from 'node:child_process';
import waitOn from 'wait-on';
import { buildElectron } from './build-electron.mjs';

const isWin = process.platform === 'win32';

function run(cmd, args, opts = {}) {
  // detached: true puts each process in its own group on POSIX, so killTree()
  // can signal the whole tree (npm -> sh -> vite) instead of just the npm wrapper.
  return spawn(cmd, args, { stdio: 'inherit', shell: isWin, detached: !isWin, ...opts });
}

function killTree(child, signal = 'SIGTERM') {
  if (!child || child.killed || child.exitCode !== null) return;
  if (isWin) {
    child.kill(signal);
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
}

async function main() {
  const vite = run('npm', ['run', 'dev', '--workspace', 'renderer']);

  await waitOn({ resources: ['http://127.0.0.1:5173'], timeout: 30_000 });

  await buildElectron();

  const electronProc = run('npx', ['electron', '.']);

  let shuttingDown = false;
  const cleanup = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    killTree(vite);
    killTree(electronProc);
    // Give processes a moment to exit cleanly before this script exits.
    setTimeout(() => process.exit(0), 300);
  };

  electronProc.on('exit', cleanup);
  vite.on('exit', cleanup);
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
