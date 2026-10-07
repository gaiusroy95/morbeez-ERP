#!/usr/bin/env node
// Runs the end-to-end suites against a real API and owner app. The suites
// form chains: each suite builds on what the ones before it left (the
// driver's completed trips, the books closed through last month), so a chain
// always runs whole and in order, on a freshly reset database:
//
//   1. E2E_RESET_CMD  — empty database → migrations → dev seed → master data
//   2. start the API  — E2E_API_CMD (as morbeez_app, so RLS applies)
//   3. the chain's suites, in order — each module's API suite, then its UI
//   4. stop the API
//
// The owner app is stateless and stays up for the whole run (E2E_WEB_CMD).
// A suite fails if it exits non-zero or prints a FAIL line.
//
//   node testing/e2e/run.js           # every chain
//   node testing/e2e/run.js finance   # just this one
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const { API, BASE } = require('./lib/env');

const CHAINS = {
  // Order is the order the modules were built in; later suites assume the
  // earlier ones' data. Add a new module's suites at the end.
  modules: [
    'owner-modules-e2e.js',
    'accounting-e2e.js', 'accounting-ui-e2e.js',
    'tax-e2e.js', 'tax-ui-e2e.js',
    'workforce-e2e.js', 'workforce-ui-e2e.js',
    'fleet-e2e.js', 'fleet-ui-e2e.js',
    'crates-e2e.js', 'crates-ui-e2e.js',
    'spot-e2e.js', 'spot-ui-e2e.js',
    'ai-e2e.js', 'ai-ui-e2e.js',
  ],
  // Backdates invoices and closes periods of its own — on a database of its own.
  finance: ['owner-modules-e2e.js', 'finance-e2e.js'],
  // Signs businesses up and ends a trial; needs nothing but the seed.
  signup: ['signup-trial-e2e.js'],
  // Driver money handover and owner trip closure; makes its own data.
  handover: ['trip-handover-e2e.js'],
  // Delegation, day-off mode, alerts and the driver PIN; makes its own data.
  delegation: ['delegation-e2e.js'],
  // Live chicken, eggs, pricing, finance charges and disputes; makes its own data.
  produce: ['chicken-eggs-finance-e2e.js'],
  // The user's language and each customer's; makes its own data.
  languages: ['languages-e2e.js'],
};

const REPO = path.resolve(__dirname, '../..');
const RESET = process.env.E2E_RESET_CMD || `bash ${path.join(__dirname, 'reset-postgres.sh')}`;
const API_CMD = process.env.E2E_API_CMD || 'node apps/backend/dist/src/main.js';
const WEB_CMD = process.env.E2E_WEB_CMD || 'pnpm --filter @morbeez/owner-app exec next start -p 3001';

function sh(cmd) {
  const r = spawnSync(cmd, { cwd: REPO, shell: true, stdio: 'inherit', env: process.env });
  if (r.status !== 0) throw new Error(`"${cmd}" exited ${r.status}`);
}

function background(cmd, name) {
  const child = spawn(cmd, { cwd: REPO, shell: true, env: process.env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
  const tail = [];
  const keep = (d) => {
    tail.push(...d.toString().split('\n'));
    tail.splice(0, Math.max(0, tail.length - 40));
  };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  child.tail = () => `--- last output of ${name} ---\n${tail.join('\n')}`;
  return child;
}

function stop(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/F', '/T', '/PID', String(child.pid)]);
  else process.kill(-child.pid, 'SIGTERM');
}

async function waitFor(url, child, seconds = 90) {
  for (let i = 0; i < seconds; i++) {
    if (child.exitCode !== null) throw new Error(`${url} did not start\n${child.tail()}`);
    const ok = await fetch(url).then((r) => r.ok, () => false);
    if (ok) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`${url} did not answer within ${seconds}s\n${child.tail()}`);
}

function runSuite(file) {
  console.log(`\n== ${file}`);
  const r = spawnSync(process.execPath, [path.join(__dirname, 'suites', file)], { cwd: REPO, env: process.env, encoding: 'utf8' });
  process.stdout.write(r.stdout);
  process.stderr.write(r.stderr);
  const failed = r.status !== 0 || /^(FAIL|FAILED)\b/m.test(r.stdout);
  const summary = r.stdout.match(/(\d+)\/(\d+) passed/);
  return { file, failed, summary: summary ? summary[0] : r.status === 0 ? 'no summary' : `exit ${r.status}` };
}

(async () => {
  const wanted = process.argv.slice(2);
  const unknown = wanted.filter((c) => !CHAINS[c]);
  if (unknown.length) throw new Error(`unknown chain(s): ${unknown.join(', ')}; known: ${Object.keys(CHAINS).join(', ')}`);
  const chains = wanted.length ? wanted : Object.keys(CHAINS);

  const web = background(WEB_CMD, 'owner app');
  const results = [];
  try {
    for (const c of chains) {
      console.log(`\n##### ${c}`);
      sh(RESET);
      const api = background(API_CMD, 'API');
      try {
        await waitFor(`${API}/health`, api);
        await waitFor(`${BASE}/login`, web);
        for (const file of CHAINS[c]) results.push({ chain: c, ...runSuite(file) });
      } catch (err) {
        results.push({ chain: c, file: '(setup)', failed: true, summary: err.message });
      } finally {
        stop(api);
      }
    }
  } finally {
    stop(web);
  }

  console.log('\n===== summary');
  for (const r of results) console.log(`${r.failed ? 'FAIL' : 'ok  '}  ${r.chain.padEnd(8)} ${r.file.padEnd(24)} ${r.summary}`);
  process.exit(results.some((r) => r.failed) ? 1 : 0);
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
