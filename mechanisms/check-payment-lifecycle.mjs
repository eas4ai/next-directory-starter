import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';

const ids = ['COM-006', 'COM-007', 'COM-008', 'COM-009'];
const results = Object.fromEntries(ids.map((id) => [id, false]));
const workspace = mkdtempSync(join(tmpdir(), 'directory-payment-lifecycle-'));
const databasePath = join(workspace, 'directory.db');
let app;
let origin;

function command(args, env) {
  const result = spawnSync('npm', args, { env, encoding: 'utf8', timeout: 120_000 });
  if (result.status !== 0) {
    throw new Error(`npm ${args[1] ?? args[0]} exited ${result.status}: ${(result.stderr ?? '').slice(-800)}`);
  }
}

function nodeTests(paths) {
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', ...paths], {
    encoding: 'utf8', timeout: 60_000,
  });
  if (result.status !== 0) {
    throw new Error(`Payment tests failed: ${(result.stdout ?? '').slice(-500)} ${(result.stderr ?? '').slice(-500)}`);
  }
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function startApp(env) {
  app = spawn('npm', ['run', 'start', '--', '-p', new URL(origin).port], {
    env, detached: true, stdio: 'ignore',
  });
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (app.exitCode !== null) break;
    try {
      const response = await fetch(origin, { signal: AbortSignal.timeout(1000) });
      if (response.status < 500) return;
    } catch { /* wait for startup */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Production server did not start.');
}

async function check(id, run) {
  try { await run(); results[id] = true; }
  catch (error) { process.stderr.write(`${id}: ${error.message}\n`); }
}

try {
  origin = `http://127.0.0.1:${await freePort()}`;
  const env = {
    ...process.env, CI: '1', DATABASE_URL: `file:${databasePath}`,
    BETTER_AUTH_SECRET: randomBytes(32).toString('hex'),
    BETTER_AUTH_URL: origin, SITE_URL: origin,
    BILLING_ENCRYPTION_KEY: randomBytes(32).toString('base64url'),
    BILLING_CHECKOUT_MODE: 'test',
  };
  command(['run', 'db:migrate'], env);
  command(['run', 'build'], env);
  await startApp(env);

  await check('COM-006', async () => {
    const { dependencies = {} } = JSON.parse(readFileSync('package.json', 'utf8'));
    if (!dependencies['@nowpaymentsio/nowpayments-sdk-nodejs']) {
      throw new Error('The official NOWPayments Node SDK is not installed for hosted checkout.');
    }
    nodeTests(['tests/hosted-checkout.test.mjs', 'tests/nowpayments-sdk.test.mjs']);
  });

  await check('COM-007', async () => {
    for (const provider of ['paddle', 'nowpayments']) {
      const response = await fetch(`${origin}/api/webhooks/${provider}/test`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      });
      if (![400, 401, 403].includes(response.status)) {
        throw new Error(`Unsigned ${provider} event returned ${response.status}, not an authentication rejection.`);
      }
    }
    nodeTests([
      'tests/payment-evidence.test.mjs',
      'tests/payment-webhooks.test.mjs',
      'tests/stripe-hosted-lifecycle.test.mjs',
    ]);
  });

  await check('COM-008', async () => {
    const database = new Database(databasePath, { readonly: true });
    try {
      const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all().map(({ name }) => name);
      if (!tables.includes('payment_periods')) {
        throw new Error('There is no durable paid-period state for renewal and expiry.');
      }
    } finally { database.close(); }
    if (!existsSync('tests/payment-lifecycle-state.test.mjs')) {
      throw new Error('Renewal, cancellation, refund, dispute, and expiry state checks are absent.');
    }
    nodeTests([
      'tests/payment-lifecycle-state.test.mjs',
      'tests/stripe-hosted-lifecycle.test.mjs',
    ]);
  });

  await check('COM-009', async () => {
    const response = await fetch(`${origin}/owner/billing`, { redirect: 'manual' });
    const denied = await fetch(`${origin}/api/owner/billing/unknown/cancel`, {
      method: 'POST', headers: { Origin: origin },
    });
    const location = response.headers.get('location') ?? '';
    const { scripts = {} } = JSON.parse(readFileSync('package.json', 'utf8'));
    if (![302, 303, 307, 308].includes(response.status) ||
        !location.includes('/owner/sign-in') || denied.status !== 401 ||
        !scripts['billing:reconcile']) {
      throw new Error('The owner payment status route or bounded reconciliation command is unavailable.');
    }
    nodeTests([
      'tests/owner-billing.test.mjs',
      'tests/payment-reconciliation.test.mjs',
      'tests/payment-provider-adapters.test.mjs',
    ]);
  });
} catch (error) {
  process.stderr.write(`payment-lifecycle setup: ${error.message}\n`);
} finally {
  if (app) {
    try { process.kill(-app.pid, 'SIGTERM'); } catch { /* already stopped */ }
    await Promise.race([
      new Promise((resolve) => app.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 2_000)),
    ]);
  }
  rmSync(workspace, { recursive: true, force: true });
  for (const id of ids) process.stdout.write(`sudus: ${id}: ${results[id] ? 'pass' : 'fail'}\n`);
}
