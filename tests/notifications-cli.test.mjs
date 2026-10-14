import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';

function command(args, env) {
  const result = spawnSync('npm', args, { env, encoding: 'utf8', timeout: 120_000 });
  assert.equal(result.status, 0, `${args.join(' ')} failed: ${result.stderr || result.stdout}`);
}

function child(args, env) {
  return new Promise((resolve, reject) => {
    const process = spawn('node', args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    process.stdout.on('data', (chunk) => { output += chunk; });
    process.stderr.on('data', (chunk) => { output += chunk; });
    process.on('error', reject);
    process.on('close', (code) => code === 0 ? resolve(output) : reject(new Error(output)));
  });
}

test('fresh worker processes retain acknowledgements and retry only exhausted mail', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'directory-mail-cli-'));
  const env = { ...process.env, DATABASE_URL: `file:${join(workspace, 'directory.db')}`,
    BETTER_AUTH_SECRET: randomBytes(32).toString('hex'),
    BETTER_AUTH_URL: 'http://127.0.0.1:3999', SITE_URL: 'http://127.0.0.1:3999',
    RESEND_API_KEY: 'local-test-key', RESEND_FROM: 'updates@example.invalid' };
  const requests = [];
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    requests.push({ path: request.url, key: request.headers['idempotency-key'], body });
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ id: `local-${requests.length}` }));
  });
  let database;
  try {
    command(['run', 'db:migrate'], env);
    command(['run', 'account:provision', '--', '--email', 'mail-cli@example.invalid',
      '--password', randomBytes(20).toString('hex'), '--role', 'user', '--yes'], env);
    database = new Database(join(workspace, 'directory.db'));
    const owner = database.prepare('SELECT id FROM "user" WHERE email = ?')
      .get('mail-cli@example.invalid').id;
    const insert = database.prepare(`INSERT INTO owner_notifications
      (id, owner_user_id, kind, source_key, subject, body, created_at,
       email_state, email_attempts, email_last_error)
      VALUES (?, ?, 'qa', ?, ?, 'Delivery check', ?, ?, ?, ?)`);
    const now = new Date().toISOString();
    insert.run('mail-ack', owner, 'qa:ack', 'Acknowledged mail', now, 'pending', 0, null);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    env.RESEND_API_BASE_URL = `http://127.0.0.1:${server.address().port}`;
    const worker = () => child(['--import', 'tsx', 'scripts/deliver-notifications.ts', '--limit', '10'], env);
    assert.match(await worker(), /attempted: 1, sent: 1, failed: 0/);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].key, 'owner-notification/mail-ack');
    assert.match(await worker(), /attempted: 0, sent: 0, failed: 0/);
    assert.equal(requests.length, 1);
    insert.run('mail-exhausted', owner, 'qa:exhausted', 'Exhausted mail', now, 'failed',
      5, 'Resend delivery failed');
    assert.match(await worker(), /attempted: 0, sent: 0, failed: 0/);
    assert.equal(requests.length, 1);
    assert.equal((await child(['--import', 'tsx', '--input-type=module', '-e',
      `const module = await import('./src/lib/notification-delivery.ts');
       const retry = module.retryOwnerNotification ?? module.default?.retryOwnerNotification;
       if (!retry('mail-exhausted')) process.exit(1);`], env)).trim(), '');
    assert.match(await worker(), /attempted: 1, sent: 1, failed: 0/);
    assert.equal(requests.length, 2);
    assert.equal(requests[1].key, 'owner-notification/mail-exhausted');
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM owner_notifications').get().count, 2);
    assert.equal(database.prepare("SELECT email_state FROM owner_notifications WHERE id = 'mail-exhausted'").get().email_state, 'sent');
  } finally {
    database?.close();
    await new Promise((resolve) => server.close(resolve));
    rmSync(workspace, { recursive: true, force: true });
  }
});
