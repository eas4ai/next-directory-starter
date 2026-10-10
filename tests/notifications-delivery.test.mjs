import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('bounded Resend worker retries durable intents without replaying acknowledged mail', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'directory-notification-delivery-'));
  const names = ['DATABASE_URL', 'RESEND_API_KEY', 'RESEND_FROM', 'RESEND_API_BASE_URL'];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  process.env.DATABASE_URL = `file:${join(directory, 'catalog.db')}`;
  let database;
  let server;
  try {
    ({ database } = await import('../src/lib/database.ts'));
    const { migrateCatalog } = await import('../src/lib/catalog-migrations.ts');
    const { recordOwnerNotification } = await import('../src/lib/notifications.ts');
    const { deliverOwnerNotifications, retryOwnerNotification,
      notificationDeliveryRows } = await import('../src/lib/notification-delivery.ts');
    migrateCatalog();
    database.exec('CREATE TABLE IF NOT EXISTS "user" (id TEXT PRIMARY KEY, email TEXT NOT NULL)');
    database.prepare("INSERT INTO \"user\" (id, email) VALUES ('owner', 'owner@example.invalid')").run();
    for (let index = 0; index < 3; index += 1) {
      recordOwnerNotification('owner', 'moderation.approve', `notice:${index}`,
        `Notice ${index}`, 'The listing was approved.');
    }
    const base = Date.now();
    const sent = [];
    let failFirst = true;
    const sender = async (payload) => {
      sent.push(payload);
      if (payload.subject === 'Notice 0' && failFirst) {
        failFirst = false;
        throw new Error('secret-provider-error');
      }
      return `message-${sent.length}`;
    };
    const first = await deliverOwnerNotifications({ limit: 1, now: new Date(base), send: sender });
    assert.deepEqual(first, { attempted: 1, sent: 0, failed: 1 });
    assert.equal(sent.length, 1);
    assert.equal(notificationDeliveryRows(10).find((row) => row.subject === 'Notice 0').emailState, 'failed');
    assert.doesNotMatch(JSON.stringify(notificationDeliveryRows(10)), /secret-provider-error/);
    const second = await deliverOwnerNotifications({ limit: 1, now: new Date(base + 10_000), send: sender });
    assert.deepEqual(second, { attempted: 1, sent: 1, failed: 0 });
    assert.equal(sent.length, 2);
    const third = await deliverOwnerNotifications({ limit: 1, now: new Date(base + 20_000), send: sender });
    assert.deepEqual(third, { attempted: 1, sent: 1, failed: 0 });
    assert.equal(sent.length, 3);
    const retry = await deliverOwnerNotifications({ limit: 1, now: new Date(base + 2 * 60_000), send: sender });
    assert.deepEqual(retry, { attempted: 1, sent: 1, failed: 0 });
    assert.equal(sent.length, 4);
    assert.equal(sent[0].idempotencyKey, sent[3].idempotencyKey);
    assert.deepEqual(await deliverOwnerNotifications({ limit: 10, now: new Date(base + 3 * 60_000), send: sender }),
      { attempted: 0, sent: 0, failed: 0 });
    assert.equal(sent.length, 4);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM owner_notifications").get().count, 3);

    recordOwnerNotification('owner', 'payment.paid', 'notice:exhaust', 'Always failing', 'A payment was confirmed.');
    const failing = async () => { throw new Error('secret-provider-error'); };
    for (let index = 0; index < 5; index += 1) {
      const outcome = await deliverOwnerNotifications({ limit: 1,
        now: new Date(base + (index + 1) * 3_600_000), send: failing });
      assert.equal(outcome.attempted, 1);
      assert.equal(outcome.failed, 1);
    }
    const exhausted = notificationDeliveryRows(10).find((row) => row.subject === 'Always failing');
    assert.equal(exhausted.emailAttempts, 5);
    assert.equal(exhausted.emailState, 'failed');
    assert.equal(exhausted.emailNextAttemptAt, null);
    assert.deepEqual(await deliverOwnerNotifications({ limit: 10,
      now: new Date(base + 10 * 3_600_000), send: sender }),
      { attempted: 0, sent: 0, failed: 0 });
    retryOwnerNotification(exhausted.id);
    assert.deepEqual(await deliverOwnerNotifications({ limit: 1,
      now: new Date(base + 11 * 3_600_000), send: sender }),
      { attempted: 1, sent: 1, failed: 0 });

    const requests = [];
    server = createServer(async (request, response) => {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      requests.push({ headers: request.headers, body: Buffer.concat(chunks).toString('utf8') });
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ id: 'resend-message-id' }));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    process.env.RESEND_API_KEY = 're_test_private_key';
    process.env.RESEND_FROM = 'Directory <updates@example.invalid>';
    process.env.RESEND_API_BASE_URL = `http://127.0.0.1:${server.address().port}`;
    recordOwnerNotification('owner', 'payment.paid', 'notice:sdk', 'SDK notice', 'A payment was confirmed.');
    assert.deepEqual(await deliverOwnerNotifications({ limit: 1,
      now: new Date(base + 12 * 3_600_000) }),
      { attempted: 1, sent: 1, failed: 0 });
    assert.equal(requests.length, 1);
    assert.match(requests[0].headers['idempotency-key'], /^owner-notification\//);
    assert.match(requests[0].body, /SDK notice/);
    assert.doesNotMatch(requests[0].body, /private_key|webhook|raw payload/i);
    assert.equal(notificationDeliveryRows(10).find((row) => row.subject === 'SDK notice').emailState, 'sent');

    recordOwnerNotification('owner', 'general', 'notice:abandoned', 'Abandoned claim', 'Safe text.');
    recordOwnerNotification('owner', 'general', 'notice:unknown', 'Unknown outcome', 'Safe text.');
    database.prepare(`UPDATE owner_notifications SET email_state = 'sending',
      email_attempts = 1, email_first_attempt_at = ?, email_claimed_until = ?,
      email_claim_token = 'old-claim', email_to = 'owner@example.invalid',
      email_from = 'Directory <updates@example.invalid>' WHERE source_key = 'notice:abandoned'`)
      .run(new Date(base + 12 * 3_600_000).toISOString(), new Date(base + 12 * 3_600_000).toISOString());
    database.prepare(`UPDATE owner_notifications SET email_state = 'failed',
      email_attempts = 1, email_first_attempt_at = ?, email_next_attempt_at = ?,
      email_to = 'owner@example.invalid', email_from = 'Directory <updates@example.invalid>'
      WHERE source_key = 'notice:unknown'`)
      .run(new Date(base - 30 * 3_600_000).toISOString(),
        new Date(base - 29 * 3_600_000).toISOString());
    assert.deepEqual(await deliverOwnerNotifications({ limit: 10,
      now: new Date(base + 13 * 3_600_000), send: sender }),
      { attempted: 1, sent: 1, failed: 0 });
    const unknown = notificationDeliveryRows(10).find((row) => row.subject === 'Unknown outcome');
    assert.equal(unknown.emailState, 'failed');
    assert.equal(unknown.emailNextAttemptAt, null);
    assert.match(unknown.emailLastError, /inspect Resend/i);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    database?.close();
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});
