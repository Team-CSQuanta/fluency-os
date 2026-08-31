import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const common = {
  platform: 'node',
  target: 'node18',
  bundle: true,
  format: 'cjs',
  external: ['electron'],
  sourcemap: true,
  logLevel: 'info',
};

export async function buildElectron() {
  await build({
    ...common,
    entryPoints: [path.join(root, 'electron/main/index.ts')],
    outfile: path.join(root, 'dist-electron/main.cjs'),
  });
  await build({
    ...common,
    entryPoints: [path.join(root, 'electron/preload/index.ts')],
    outfile: path.join(root, 'dist-electron/preload.cjs'),
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  buildElectron()
    .then(() => console.log('electron build complete'))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
