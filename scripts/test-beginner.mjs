#!/usr/bin/env node
// The beginner tests only — a short, readable set to show how FluencyOS is
// tested. `npm test` runs everything (1,000+ tests); this runs 24:
//
//   backend/tests/beginner/test_1_simple_functions.py   unit tests (Python)
//   backend/tests/beginner/test_2_api_basics.py          API tests (Python)
//   renderer/src/tests-beginner/simple.test.ts           frontend tests (TypeScript)
//   ui-tests/                                            UI tests in Chrome (Python + Selenium)

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isWindows = process.platform === 'win32';

function part(title, cmd, args, cwd) {
  console.log(`\n=== ${title} ===\n`);
  const res = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: isWindows });
  return res.status === 0;
}

const backendOk = part(
  'Backend tests (Python + pytest)',
  'uv',
  ['run', 'pytest', 'tests/beginner', '-v', '--no-header', '-p', 'no:cacheprovider', '-p', 'no:warnings'],
  path.join(root, 'backend'),
);
const frontendOk = part(
  'Frontend tests (TypeScript + Vitest)',
  'npx',
  ['vitest', 'run', 'src/tests-beginner', '--reporter=verbose'],
  path.join(root, 'renderer'),
);

// A visible Chrome window, so the clicking can be watched. HEADLESS=1 hides it.
const uiOk = part(
  'UI tests in a real browser (Python + Selenium)',
  'uv',
  ['run', '--project', 'backend', 'pytest', 'ui-tests', '-v', '--no-header', '-p', 'no:cacheprovider', '-p', 'no:warnings'],
  root,
);

console.log(
  backendOk && frontendOk && uiOk
    ? '\nAll beginner tests passed.\n'
    : '\nSome beginner tests failed — the red lines above say which, and why.\n',
);
process.exit(backendOk && frontendOk && uiOk ? 0 : 1);
