import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('reconciliation quarantines exhausted evidence and advances to newer due work', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'directory-reconciliation-batching-'));
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = `file:${join(directory, 'catalog.db')}`;
  let database;
  try {
    ({ database } = await import('../src/lib/database.ts'));
    const { migrateCatalog } = await import('../src/lib/catalog-migrations.ts');
    const { retainVerifiedEvidence } = await import('../src/lib/payment-lifecycle.ts');
    const { retryRetainedEvidence } = await import('../src/lib/payment-reconciliation.ts');
    migrateCatalog();

    const invalid = {
      provider: 'stripe', mode: 'test', eventId: 'old-invalid', eventType: 'invoice.paid',
      raw: { id: 'old-invalid' },
      effect: { kind: 'paid', purchaseId: 'missing', resourceId: 'in_missing',
        paymentId: 'in_missing', priceId: 'price_missing', amountMinor: 100, currency: 'usd' },
    };
    assert.deepEqual(retainVerifiedEvidence(invalid), { processed: false });
    const scheduled = database.prepare(`SELECT attempts, next_attempt_at, quarantined_at
      FROM payment_evidence WHERE event_id = 'old-invalid'`).get();
    assert.equal(scheduled.attempts, 1);
    assert.equal(Date.parse(scheduled.next_attempt_at) > Date.now(), true);
    assert.equal(scheduled.quarantined_at, null);
    database.prepare(`UPDATE payment_evidence SET attempts = 7, next_attempt_at = ?, received_at = ?
      WHERE event_id = 'old-invalid'`).run('2026-01-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z');
    database.prepare(`INSERT INTO payment_evidence
      (provider, mode, event_id, event_type, payload, state, attempts, received_at, next_attempt_at)
      VALUES ('stripe', 'test', 'new-recoverable', 'test.noop', ?, 'unresolved', 1, ?, ?)`)
      .run(JSON.stringify({ raw: { id: 'new-recoverable' }, effect: { kind: 'noop' } }),
        '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z');
    assert.deepEqual(retryRetainedEvidence(1), {
      attempted: 1, processed: 0, unresolved: 1, quarantined: 1,
    });
    assert.deepEqual(retryRetainedEvidence(1), {
      attempted: 1, processed: 1, unresolved: 0, quarantined: 1,
    });
    assert.deepEqual(database.prepare(`SELECT event_id, state, attempts,
        next_attempt_at, quarantined_at FROM payment_evidence ORDER BY received_at`).all(), [
      { event_id: 'old-invalid', state: 'unresolved', attempts: 8,
        next_attempt_at: null, quarantined_at: database.prepare(`SELECT quarantined_at
          FROM payment_evidence WHERE event_id = 'old-invalid'`).get().quarantined_at },
      { event_id: 'new-recoverable', state: 'processed', attempts: 2,
        next_attempt_at: null, quarantined_at: null },
    ]);
    assert.equal(database.prepare(`SELECT quarantined_at FROM payment_evidence
      WHERE event_id = 'old-invalid'`).get().quarantined_at !== null, true);
  } finally {
    database?.close();
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});
