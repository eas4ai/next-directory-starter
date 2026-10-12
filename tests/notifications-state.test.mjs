import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('moderation and verified payment changes retain one private notice atomically', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'directory-notifications-state-'));
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = `file:${join(directory, 'catalog.db')}`;
  let database;
  try {
    ({ database } = await import('../src/lib/database.ts'));
    const { migrateCatalog } = await import('../src/lib/catalog-migrations.ts');
    const { createOwnerListing, submitOwnerListing, decideSubmission } = await import('../src/lib/moderation.ts');
    const { retainVerifiedEvidence } = await import('../src/lib/payment-lifecycle.ts');
    const { listOwnerNotifications, recordOwnerNotification } = await import('../src/lib/notifications.ts');
    migrateCatalog();
    database.exec('CREATE TABLE IF NOT EXISTS "user" (id TEXT PRIMARY KEY, email TEXT, banned INTEGER NOT NULL DEFAULT 0)');
    database.prepare("INSERT INTO \"user\" (id, email) VALUES ('owner', 'owner@example.invalid')").run();
    database.prepare("INSERT INTO categories (name) VALUES ('Tools')").run();
    const listing = (slug) => ({ slug, name: slug, summary: 'Summary',
      description: 'Description', category: 'Tools', url: `https://example.org/${slug}` });
    createOwnerListing('owner', listing('approved'));
    const approved = submitOwnerListing('owner', 'approved');
    decideSubmission(approved.id, 'moderator', 'approve', 'Good');
    assert.equal(listOwnerNotifications('owner').length, 1);
    assert.equal(listOwnerNotifications('stranger').length, 0);
    assert.throws(() => decideSubmission(approved.id, 'moderator', 'approve', 'Replay'));
    assert.equal(listOwnerNotifications('owner').length, 1);

    createOwnerListing('owner', listing('rejected'));
    const rejected = submitOwnerListing('owner', 'rejected');
    database.exec(`CREATE TRIGGER fail_notice BEFORE INSERT ON owner_notifications
      BEGIN SELECT RAISE(ABORT, 'notification storage failed'); END;`);
    assert.throws(() => decideSubmission(rejected.id, 'moderator', 'reject', 'Needs work'),
      /notification storage failed/);
    assert.equal(database.prepare('SELECT status FROM submissions WHERE id = ?').get(rejected.id).status, 'pending');
    database.exec('DROP TRIGGER fail_notice');
    decideSubmission(rejected.id, 'moderator', 'reject', 'Needs work');
    assert.equal(listOwnerNotifications('owner').length, 2);

    database.prepare(`INSERT INTO publishing_plans
      (key, name, description, mode, billing_mode, amount_minor, currency,
        duration_days, featured, enabled, updated_at)
      VALUES ('paid', 'Paid', '', 'test', 'one-time', 1200, 'usd', 30, 1, 1, ?)`)
      .run(new Date().toISOString());
    database.prepare(`INSERT INTO purchases
      (id, listing_slug, owner_user_id, plan_key, plan_mode, billing_mode, plan_name,
        plan_description, amount_minor, currency, duration_days, accepted_duration_days,
        featured, stripe_session_id, status, created_at, provider, provider_resource_id)
      VALUES ('purchase', 'approved', 'owner', 'paid', 'test', 'one-time', 'Paid', '',
        1200, 'usd', 30, 30, 1, 'pending:purchase', 'pending', ?, 'paddle', 'txn_paid')`)
      .run(new Date().toISOString());
    const evidence = { provider: 'paddle', mode: 'test', eventId: 'paid-event',
      eventType: 'transaction.completed', raw: { id: 'paid-event' }, effect: {
        kind: 'paid', purchaseId: 'purchase', resourceId: 'txn_paid', paymentId: 'txn_paid',
        amountMinor: 1200, currency: 'usd',
      } };
    database.exec(`CREATE TRIGGER fail_notice BEFORE INSERT ON owner_notifications
      BEGIN SELECT RAISE(ABORT, 'notification storage failed'); END;`);
    assert.deepEqual(retainVerifiedEvidence(evidence), { processed: false });
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM payment_periods WHERE purchase_id = 'purchase'").get().count, 0);
    database.exec('DROP TRIGGER fail_notice');
    assert.deepEqual(retainVerifiedEvidence(evidence), { processed: true });
    assert.deepEqual(retainVerifiedEvidence(evidence), { processed: true });
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM payment_periods WHERE purchase_id = 'purchase'").get().count, 1);
    assert.equal(listOwnerNotifications('owner').length, 3);

    const disputeAt = Date.now();
    for (const [eventId, effect] of [
      ['dispute-open', { kind: 'dispute', paymentId: 'txn_paid', disputeId: 'adj_notice',
        open: true, terminal: false, occurredAt: new Date(disputeAt).toISOString() }],
      ['dispute-close', { kind: 'dispute', paymentId: 'txn_paid', disputeId: 'adj_notice',
        open: false, terminal: true, occurredAt: new Date(disputeAt + 1000).toISOString() }],
      ['refund-full', { kind: 'refund', paymentId: 'txn_paid', full: true,
        amountMinor: 1200, currency: 'usd' }],
    ]) {
      const outcome = { provider: 'paddle', mode: 'test', eventId, eventType: eventId,
        raw: { id: eventId }, effect };
      assert.deepEqual(retainVerifiedEvidence(outcome), { processed: true });
      assert.deepEqual(retainVerifiedEvidence(outcome), { processed: true });
    }
    assert.equal(listOwnerNotifications('owner').length, 6);

    for (let index = 0; index < 25; index += 1) {
      recordOwnerNotification('owner', 'general', `extra:${index}`, `Notice ${index}`, 'A safe message.');
    }
    assert.equal(listOwnerNotifications('owner').length, 20);
    assert.equal(listOwnerNotifications('stranger').length, 0);
  } finally {
    database?.close();
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});
