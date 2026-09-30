#!/usr/bin/env node
// Runs the backend test suite, and writes one report of what ran.
//
//   npm test                 the pytest suite, then test-reports/index.html
//   npm test -- --verbose    print every test's name as it runs
//   npm test -- --open       open the report in the browser afterwards
//
// The suite is spread over every CPU core, with line coverage of the
// backend's `app` package. The exit code is non-zero if anything failed, so
// CI fails too.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reports = path.join(root, 'test-reports');
const args = new Set(process.argv.slice(2));
const verbose = args.has('--verbose') || args.has('-v');
const isWindows = process.platform === 'win32';

rmSync(reports, { recursive: true, force: true });
mkdirSync(reports, { recursive: true });

const bold = (s) => (process.stdout.isTTY ? `\x1b[1m${s}\x1b[0m` : s);
const green = (s) => (process.stdout.isTTY ? `\x1b[32m${s}\x1b[0m` : s);
const red = (s) => (process.stdout.isTTY ? `\x1b[31m${s}\x1b[0m` : s);

function banner(title) {
  console.log(`\n${bold(`━━ ${title} `.padEnd(72, '━'))}\n`);
}

/** Runs a command with its output streaming to the terminal. Relative paths
 * only in `argv` — the repo may live under a folder with spaces in its name. */
function run(cmd, argv, cwd, { capture = false, env = {} } = {}) {
  const started = Date.now();
  const res = spawnSync(cmd, argv, {
    cwd,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    shell: isWindows,
    encoding: 'utf8',
    env: { ...process.env, FORCE_COLOR: process.stdout.isTTY ? '1' : '0', ...env },
  });
  if (res.error) {
    return { ok: false, seconds: 0, output: `Could not start ${cmd}: ${res.error.message}` };
  }
  const output = capture ? `${res.stdout ?? ''}${res.stderr ?? ''}` : '';
  if (capture && output.trim()) process.stdout.write(output);
  return { ok: res.status === 0, seconds: (Date.now() - started) / 1000, output };
}

// ── Backend ───────────────────────────────────────────────────────────────────
banner('Backend tests (pytest, parallel, with coverage)');
const pytest = run(
  'uv',
  [
    'run',
    'pytest',
    '-n',
    'auto',
    verbose ? '-v' : '-q',
    '-p',
    'no:cacheprovider',
    '--junitxml=../test-reports/backend-junit.xml',
    '--cov=app',
    '--cov-report=html:../test-reports/coverage',
    '--cov-report=json:../test-reports/coverage.json',
  ].filter(Boolean),
  path.join(root, 'backend'),
);

// ── Collect results ──────────────────────────────────────────────────────────

/** What each Python test file is about, from its module docstring. */
function describeFile(file) {
  try {
    const src = readFileSync(path.join(root, 'backend', 'tests', file), 'utf8');
    const m = src.match(/^\s*(?:#[^\n]*\n\s*)*("""|''')([\s\S]*?)\1/);
    if (!m) return '';
    const para = m[2].trim().split(/\n\s*\n/)[0];
    return para.replace(/\s+/g, ' ').trim();
  } catch {
    return '';
  }
}

const decode = (s) =>
  s
    .replace(/&#10;/g, '\n')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

function readJunit(name) {
  const file = path.join(reports, name);
  if (!existsSync(file)) return [];
  const xml = readFileSync(file, 'utf8');
  const tests = [];
  for (const m of xml.matchAll(/<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g)) {
    const attrs = Object.fromEntries([...m[1].matchAll(/(\w+)="([^"]*)"/g)].map((a) => [a[1], decode(a[2])]));
    const body = m[2] ?? '';
    const failure = body.match(/<(failure|error)\b[^>]*?(?:message="([^"]*)")?[^>]*>([\s\S]*?)<\/\1>/);
    const skipped = /<skipped\b/.test(body);
    const moduleName = (attrs.classname ?? '').split('.').find((p) => p.startsWith('test_')) ?? 'other';
    tests.push({
      file: `${moduleName}.py`,
      name: attrs.name,
      seconds: Number(attrs.time ?? 0),
      status: failure ? 'failed' : skipped ? 'skipped' : 'passed',
      message: failure ? decode(failure[3] || failure[2] || '').trim() : '',
    });
  }
  return tests;
}

function readCoverage() {
  const file = path.join(reports, 'coverage.json');
  if (!existsSync(file)) return null;
  const json = JSON.parse(readFileSync(file, 'utf8'));
  const areas = {};
  for (const [name, data] of Object.entries(json.files)) {
    const area = name.split(/[\\/]/).slice(0, 2).join('/'); // app/services, app/routers, …
    areas[area] ??= { covered: 0, statements: 0 };
    areas[area].covered += data.summary.covered_lines;
    areas[area].statements += data.summary.num_statements;
  }
  return { percent: json.totals.percent_covered, lines: json.totals.num_statements, areas };
}

const backend = readJunit('backend-junit.xml');
const coverage = readCoverage();

// Which part of the app each backend test file exercises — the report is
// organised the way the product is, not the way the folder is.
// First match wins, so the narrower rules come first.
const AREAS = [
  ['Progress & forest', /^test_(forest|reading_goal|activity)/],
  ['Learn by reading', /^test_(book|books|epub|pdf|mobi|txt|ingest|pagination|native_pages|page_|reader|reading|highlights|search|jump|difficulty|cefr_lexicon)/],
  ['Learn by watching', /^test_media/],
  ['Speech to text', /^test_stt/],
  ['Vocabulary & dictionary', /^test_(vocab|dictionary|pronunciation)/],
  ['Review (flashcards)', /^test_(review|fsrs)/],
  ['Conversation', /^test_(conversation|chat_history|target_words|json_salvage)/],
  ['Voice & AI engines', /^test_(tts|cloud_llm|gemini|compute|hardware)/],
  ['Scene challenge', /^test_challenge/],
  ['Levels & placement', /^test_(level|leveling|placement)/],
  ['Profile, onboarding & settings', /^test_(profile|onboarding|settings)/],
  ['Platform', /./],
];
const areaOf = (file) => AREAS.find(([, re]) => re.test(file))[0];
// Shown in the order the app presents its features.
const AREA_ORDER = [
  'Learn by reading',
  'Learn by watching',
  'Speech to text',
  'Vocabulary & dictionary',
  'Review (flashcards)',
  'Conversation',
  'Voice & AI engines',
  'Scene challenge',
  'Levels & placement',
  'Progress & forest',
  'Profile, onboarding & settings',
  'Platform',
];
const byAreaOrder = (a, b) => AREA_ORDER.indexOf(a[0]) - AREA_ORDER.indexOf(b[0]);

const count = (tests, status) => tests.filter((t) => t.status === status).length;
const all = backend;
const totals = {
  total: all.length,
  passed: count(all, 'passed'),
  failed: count(all, 'failed'),
  skipped: count(all, 'skipped'),
  seconds: pytest.seconds,
};
const everythingOk = pytest.ok;

// ── Terminal summary ─────────────────────────────────────────────────────────
const line = (label, ok, detail) => console.log(`  ${ok ? green('✓') : red('✗')} ${label.padEnd(22)} ${detail}`);
console.log(`\n${bold('━━ Summary '.padEnd(72, '━'))}\n`);
line(
  'Backend (pytest)',
  pytest.ok,
  `${count(backend, 'passed')}/${backend.length} passed · ${pytest.seconds.toFixed(1)}s` +
    (coverage ? ` · ${coverage.percent.toFixed(1)}% line coverage` : ''),
);
console.log(`\n  ${bold(`${totals.passed} of ${totals.total} tests passed`)}${totals.failed ? red(` · ${totals.failed} failed`) : ''}`);

// ── HTML report ──────────────────────────────────────────────────────────────
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** "test_a_pocket_voice_still_downloading_speaks_in_the_default[kokoro]"
 *   → "A pocket voice still downloading speaks in the default (kokoro)" */
function readable(name) {
  const m = name.match(/^test_(.*?)(?:\[(.*)\])?$/);
  if (!m) return name;
  const words = m[1].replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1) + (m[2] ? ` (${m[2]})` : '');
}

function testRow(t, label) {
  const icon = t.status === 'passed' ? '✓' : t.status === 'failed' ? '✗' : '–';
  const failure = t.message
    ? `<details class="why"><summary>Why it failed</summary><pre>${esc(t.message.slice(0, 4000))}</pre></details>`
    : '';
  return `<li class="t ${t.status}" data-text="${esc(label.toLowerCase())}"><span class="ic">${icon}</span><span class="nm">${esc(label)}</span><span class="tm">${t.seconds < 0.01 ? '' : `${t.seconds.toFixed(2)}s`}</span>${failure}</li>`;
}

function fileBlock(file, tests, description, labelOf) {
  const failed = count(tests, 'failed');
  return `<details class="file"${failed ? ' open' : ''}>
  <summary><span class="fname">${esc(file)}</span><span class="fdesc">${esc(description)}</span><span class="fcount ${failed ? 'bad' : 'good'}">${count(tests, 'passed')}/${tests.length}</span></summary>
  <ul>${tests.map((t) => testRow(t, labelOf(t))).join('')}</ul>
</details>`;
}

function section(title, blurb, tests, groups) {
  const failed = count(tests, 'failed');
  return `<section class="area" data-area>
  <h3><span>${esc(title)}</span><span class="acount ${failed ? 'bad' : 'good'}">${count(tests, 'passed')} / ${tests.length} passed</span></h3>
  ${blurb ? `<p class="blurb">${esc(blurb)}</p>` : ''}
  ${groups}
</section>`;
}

const byKey = (tests, key) => {
  const map = new Map();
  for (const t of tests) {
    const k = key(t);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(t);
  }
  return map;
};

const backendSections = [...byKey(backend, (t) => areaOf(t.file))]
  .sort(byAreaOrder)
  .map(([area, tests]) =>
    section(
      area,
      '',
      tests,
      [...byKey(tests, (t) => t.file)]
        .map(([file, ts]) => fileBlock(file, ts, describeFile(file), (t) => readable(t.name)))
        .join(''),
    ),
  )
  .join('');

const git = (argv) => {
  const r = spawnSync('git', argv, { cwd: root, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : '';
};
const commit = git(['rev-parse', '--short', 'HEAD']);
const dirty = git(['status', '--porcelain']) ? ' (with uncommitted changes)' : '';
const pyVersion = spawnSync('uv', ['run', 'python', '--version'], {
  cwd: path.join(root, 'backend'),
  encoding: 'utf8',
  shell: isWindows,
}).stdout?.trim();
const ranAt = new Date();

const coverageRows = coverage
  ? Object.entries(coverage.areas)
      .filter(([, a]) => a.statements > 0)
      .sort((a, b) => b[1].statements - a[1].statements)
      .map(([area, a]) => {
        const pct = (a.covered / a.statements) * 100;
        return `<tr><td>${esc(area)}</td><td class="num">${a.statements}</td><td class="bar"><span style="width:${pct.toFixed(1)}%"></span></td><td class="num">${pct.toFixed(1)}%</td></tr>`;
      })
      .join('')
  : '';

const checkRow = (label, detail, ok) =>
  `<div class="check ${ok ? 'good' : 'bad'}"><span class="ic">${ok ? '✓' : '✗'}</span><div><div class="cl">${esc(label)}</div><div class="cd">${esc(detail)}</div></div></div>`;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>FluencyOS Test Report</title>
<style>
:root{--bg:#f4f4f1;--panel:#fff;--line:rgba(20,24,22,.1);--tx:#171a19;--tx2:rgba(23,26,25,.66);--tx3:rgba(23,26,25,.45);--acc:#6f51a6;--good:#2f7d4a;--goodSoft:rgba(47,125,74,.1);--bad:#b8412c;--badSoft:rgba(184,65,44,.1)}
@media (prefers-color-scheme:dark){:root{--bg:#131514;--panel:#1e2120;--line:rgba(255,255,255,.09);--tx:#e9ebe9;--tx2:rgba(233,235,233,.66);--tx3:rgba(233,235,233,.42);--acc:#a58ad6;--good:#5cbf7d;--goodSoft:rgba(92,191,125,.12);--bad:#e0735e;--badSoft:rgba(224,115,94,.13)}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--tx);font:14px/1.55 Inter,system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:1040px;margin:0 auto;padding:32px 16px 64px}
h1{font-size:26px;margin:0;letter-spacing:-.01em}
h2{font-size:13px;text-transform:uppercase;letter-spacing:.12em;color:var(--tx3);margin:36px 0 12px}
.meta{color:var(--tx2);margin-top:6px;font-size:13px}
.verdict{display:inline-block;margin-top:16px;padding:6px 12px;border-radius:999px;font-weight:600;font-size:13px}
.verdict.good{background:var(--goodSoft);color:var(--good)}.verdict.bad{background:var(--badSoft);color:var(--bad)}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-top:22px}
.stat{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px 16px}
.stat .v{font-size:28px;font-weight:650;font-variant-numeric:tabular-nums}.stat .l{color:var(--tx3);font-size:12px}
.stat.good .v{color:var(--good)}.stat.bad .v{color:var(--bad)}
.checks{display:grid;gap:8px}
.check{display:flex;gap:12px;align-items:flex-start;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px 16px}
.check .ic{font-weight:700;font-size:16px;line-height:1.3}.check.good .ic{color:var(--good)}.check.bad .ic{color:var(--bad)}
.cl{font-weight:600}.cd{color:var(--tx2);font-size:13px}
.tools{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:8px 0 14px}
.tools input[type=search]{flex:1;min-width:200px;padding:9px 12px;border-radius:10px;border:1px solid var(--line);background:var(--panel);color:var(--tx);font:inherit}
.tools label{color:var(--tx2);font-size:13px;display:flex;gap:6px;align-items:center}
.area{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px 16px;margin-bottom:12px}
.area h3{display:flex;justify-content:space-between;gap:12px;margin:0;font-size:16px}
.acount,.fcount{font-size:12px;font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap}
.good{color:var(--good)}.bad{color:var(--bad)}
.blurb{color:var(--tx2);font-size:13px;margin:6px 0 0}
details.file{border-top:1px solid var(--line);margin-top:10px;padding-top:8px}
details.file>summary{cursor:pointer;display:grid;grid-template-columns:10px auto 1fr auto;gap:10px;align-items:baseline;list-style:none}
details.file>summary::-webkit-details-marker{display:none}
details.file>summary::before{content:'▸';color:var(--tx3)}
details.file[open]>summary::before{content:'▾'}
.fname{font-family:ui-monospace,Menlo,monospace;font-size:12.5px}
.fdesc{color:var(--tx3);font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
ul{list-style:none;margin:8px 0 4px;padding:0}
li.t{display:grid;grid-template-columns:18px 1fr auto;gap:8px;padding:3px 0 3px 18px;font-size:13px}
li.t .ic{font-weight:700}li.t.passed .ic{color:var(--good)}li.t.failed .ic{color:var(--bad)}li.t.skipped .ic{color:var(--tx3)}
li.t .tm{color:var(--tx3);font-size:11.5px;font-variant-numeric:tabular-nums}
li.t .why{grid-column:2/4}
pre{white-space:pre-wrap;word-break:break-word;background:var(--badSoft);padding:10px;border-radius:8px;font-size:12px;margin:6px 0}
table{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden}
td,th{padding:8px 12px;border-bottom:1px solid var(--line);font-size:13px;text-align:left}
th{color:var(--tx3);font-weight:600;font-size:12px}
td.num{text-align:right;font-variant-numeric:tabular-nums;width:1%;white-space:nowrap}
td.bar{width:40%}td.bar span{display:block;height:8px;border-radius:4px;background:var(--acc);opacity:.75}
a{color:var(--acc)}
.hidden{display:none!important}
@media (max-width:600px){.fdesc{display:none}details.file>summary{grid-template-columns:10px 1fr auto}}
</style>
</head>
<body>
<main>
  <h1>FluencyOS — Test report</h1>
  <div class="meta">Run ${esc(ranAt.toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short' }))} · commit ${esc(commit || 'unknown')}${esc(dirty)} · ${esc(`${os.type()} ${os.release()}`)} · ${os.cpus().length} CPU cores · Node ${esc(process.version)}${pyVersion ? ` · ${esc(pyVersion)}` : ''}</div>
  <div class="verdict ${everythingOk ? 'good' : 'bad'}">${everythingOk ? 'All checks passed' : 'Some checks failed'}</div>

  <div class="stats">
    <div class="stat"><div class="v">${totals.total}</div><div class="l">tests run</div></div>
    <div class="stat good"><div class="v">${totals.passed}</div><div class="l">passed</div></div>
    <div class="stat ${totals.failed ? 'bad' : ''}"><div class="v">${totals.failed}</div><div class="l">failed</div></div>
    ${coverage ? `<div class="stat"><div class="v">${coverage.percent.toFixed(1)}%</div><div class="l">backend line coverage</div></div>` : ''}
    <div class="stat"><div class="v">${Math.round(totals.seconds)}s</div><div class="l">total run time</div></div>
  </div>

  <h2>Checks</h2>
  <div class="checks">
    ${checkRow('Backend tests — pytest', `${count(backend, 'passed')} of ${backend.length} passed in ${pytest.seconds.toFixed(1)}s across ${os.cpus().length} cores; these run the real API, database migrations and file parsers against temporary data`, pytest.ok && count(backend, 'failed') === 0)}
  </div>

  <h2>Every test</h2>
  <div class="tools">
    <input id="q" type="search" placeholder="Filter tests, e.g. voice, flashcard, subtitle…" aria-label="Filter tests">
    <label><input id="failedOnly" type="checkbox"> failures only</label>
    <label><input id="expand" type="checkbox"> expand all</label>
  </div>
  <h2>Backend, by feature</h2>
  ${backendSections}

  ${
    coverage
      ? `<h2>Backend coverage</h2>
  <p class="meta">How much of the backend's code the tests executed: ${coverage.percent.toFixed(1)}% of ${coverage.lines.toLocaleString()} lines. <a href="coverage/index.html">Line-by-line coverage report →</a></p>
  <table><thead><tr><th>Package</th><th>Lines</th><th></th><th>Covered</th></tr></thead><tbody>${coverageRows}</tbody></table>`
      : ''
  }
</main>
<script>
(function(){
  var q=document.getElementById('q'),failedOnly=document.getElementById('failedOnly'),expand=document.getElementById('expand');
  function apply(){
    var term=q.value.trim().toLowerCase(),onlyBad=failedOnly.checked;
    document.querySelectorAll('details.file').forEach(function(file){
      var shown=0;
      file.querySelectorAll('li.t').forEach(function(li){
        var ok=(!term||li.dataset.text.indexOf(term)!==-1||file.querySelector('summary').textContent.toLowerCase().indexOf(term)!==-1)&&(!onlyBad||li.classList.contains('failed'));
        li.classList.toggle('hidden',!ok);if(ok)shown++;
      });
      file.classList.toggle('hidden',shown===0);
      if(term||onlyBad)file.open=shown>0;
    });
    document.querySelectorAll('[data-area]').forEach(function(a){a.classList.toggle('hidden',!a.querySelector('details.file:not(.hidden)'))});
  }
  q.addEventListener('input',apply);failedOnly.addEventListener('change',apply);
  expand.addEventListener('change',function(){document.querySelectorAll('details.file').forEach(function(d){d.open=expand.checked})});
})();
</script>
</body>
</html>`;

writeFileSync(path.join(reports, 'index.html'), html);
const reportPath = path.join(reports, 'index.html');
console.log(`\n  Report: ${reportPath}\n`);

// On GitHub Actions, the same summary on the run's own page.
if (process.env.GITHUB_STEP_SUMMARY) {
  const mark = (ok) => (ok ? '✅' : '❌');
  const md = [
    `## ${mark(everythingOk)} ${totals.passed} of ${totals.total} tests passed`,
    '',
    '| Check | Result | Time |',
    '| --- | --- | --- |',
    `| Backend (pytest) | ${mark(pytest.ok)} ${count(backend, 'passed')}/${backend.length} passed${coverage ? ` · ${coverage.percent.toFixed(1)}% line coverage` : ''} | ${pytest.seconds.toFixed(0)}s |`,
    '',
    ...[...byKey(backend, (t) => areaOf(t.file))].sort(byAreaOrder).map(
      ([area, ts]) => `- **${area}** — ${count(ts, 'passed')}/${ts.length} passed`,
    ),
    '',
    'The full report, with every test by name and line-by-line coverage, is attached below as the `test-report` artifact.',
    '',
  ].join('\n');
  writeFileSync(process.env.GITHUB_STEP_SUMMARY, md, { flag: 'a' });
}

if (args.has('--open')) {
  const opener = isWindows ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  spawnSync(opener, isWindows ? ['""', `"${reportPath}"`] : [reportPath], { shell: isWindows, stdio: 'ignore' });
}

process.exit(everythingOk ? 0 : 1);
