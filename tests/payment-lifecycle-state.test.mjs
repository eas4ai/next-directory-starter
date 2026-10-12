import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('paid periods honor cancellation, partial and full refunds, disputes, expiry, moderation, and mode', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'directory-payment-state-'));
  const names = ['DATABASE_URL', 'BILLING_CHECKOUT_MODE'];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  process.env.DATABASE_URL = `file:${join(directory, 'catalog.db')}`;
  process.env.BILLING_CHECKOUT_MODE = 'test';
  let database;
  try {
    ({ database } = await import('../src/lib/database.ts'));
    const { migrateCatalog } = await import('../src/lib/catalog-migrations.ts');
    const { retainVerifiedEvidence } = await import('../src/lib/payment-lifecycle.ts');
    const { activeFeaturedSlugs } = await import('../src/lib/listings.ts');
    migrateCatalog();
    database.exec('CREATE TABLE IF NOT EXISTS "user" (id TEXT PRIMARY KEY, banned INTEGER NOT NULL DEFAULT 0)');
    database.prepare('INSERT INTO categories (name) VALUES (?)').run('Tools');
    database.prepare(`INSERT INTO listings
      (slug, name, summary, description, category, url, status, owner_user_id)
      VALUES ('mine', 'Mine', 'Summary', 'Description', 'Tools', 'https://example.org', 'published', 'owner')`).run();
    database.prepare(`INSERT INTO publishing_plans
      (key, name, description, mode, billing_mode, amount_minor, currency,
        duration_days, featured, enabled, updated_at)
      VALUES ('monthly', 'Monthly', '', 'test', 'monthly', 1200, 'usd', NULL, 1, 1, ?)`).run(new Date().toISOString());
    database.prepare(`INSERT INTO purchases
      (id, listing_slug, owner_user_id, plan_key, plan_mode, billing_mode, plan_name,
        plan_description, amount_minor, currency, duration_days, accepted_duration_days,
        featured, stripe_session_id, status, created_at, provider,
        provider_resource_id, provider_subscription_id, provider_price_id)
      VALUES ('purchase', 'mine', 'owner', 'monthly', 'test', 'monthly', 'Monthly', '',
        1200, 'usd', 0, NULL, 1, 'pending:purchase', 'pending', ?, 'paddle',
        'txn_first', 'sub_first', 'pri_monthly')`).run(new Date().toISOString());
    const send = (id, effect) => retainVerifiedEvidence({ provider: 'paddle', mode: 'test',
      eventId: id, eventType: effect.kind, raw: { id, effect }, effect });
    const starts = new Date(Date.now() - 60_000).toISOString();
    const ends = new Date(Date.now() + 25 * 86_400_000).toISOString();
    const paid = (paymentId, resourceId, start, end) => ({
      kind: 'paid', purchaseId: 'purchase', resourceId, paymentId,
      subscriptionId: 'sub_first', priceId: 'pri_monthly', amountMinor: 1200,
      currency: 'usd', periodStart: start, periodEnd: end,
    });
    assert.deepEqual(send('paid-first', paid('txn_first', 'txn_first', starts, ends)), { processed: true });
    assert.deepEqual([...activeFeaturedSlugs(['mine'])], ['mine']);
    process.env.BILLING_CHECKOUT_MODE = 'live';
    assert.equal(activeFeaturedSlugs(['mine']).size, 0);
    process.env.BILLING_CHECKOUT_MODE = 'test';
    database.prepare("UPDATE listings SET status = 'suspended' WHERE slug = 'mine'").run();
    assert.equal(activeFeaturedSlugs(['mine']).size, 0);
    database.prepare("UPDATE listings SET status = 'published' WHERE slug = 'mine'").run();
    assert.equal(activeFeaturedSlugs(['mine']).size, 1);

    assert.deepEqual(send('cancel-scheduled', { kind: 'subscription-state',
      purchaseId: 'purchase', subscriptionId: 'sub_first', state: 'cancel-scheduled',
      occurredAt: new Date().toISOString() }), { processed: true });
    assert.equal(database.prepare("SELECT state FROM subscription_states WHERE purchase_id = 'purchase'").get().state,
      'cancel-scheduled');
    assert.equal(activeFeaturedSlugs(['mine']).size, 1);
    assert.deepEqual(send('failed-renewal', { kind: 'noop' }), { processed: true });
    assert.equal(database.prepare("SELECT ends_at FROM entitlements WHERE purchase_id = 'purchase'").get().ends_at, ends);

    assert.deepEqual(send('partial-refund', { kind: 'refund', paymentId: 'txn_first',
      refundId: 'adj_first', full: false, amountMinor: 300, currency: 'usd' }), { processed: true });
    assert.equal(activeFeaturedSlugs(['mine']).size, 1);
    assert.deepEqual(send('dispute-open', { kind: 'dispute', paymentId: 'txn_first', open: true }),
      { processed: true });
    assert.equal(activeFeaturedSlugs(['mine']).size, 0);
    assert.deepEqual(send('dispute-won', { kind: 'dispute', paymentId: 'txn_first', open: false }),
      { processed: true });
    assert.equal(activeFeaturedSlugs(['mine']).size, 1);

    const renewalEnds = new Date(Date.now() + 55 * 86_400_000).toISOString();
    assert.deepEqual(send('paid-renewal', paid('txn_second', 'txn_second', ends, renewalEnds)),
      { processed: true });
    assert.equal(database.prepare("SELECT ends_at FROM entitlements WHERE purchase_id = 'purchase'").get().ends_at,
      renewalEnds);
    assert.deepEqual(send('full-refund-renewal', { kind: 'refund', paymentId: 'txn_second',
      full: true, amountMinor: 1200, currency: 'usd' }), { processed: true });
    assert.equal(database.prepare("SELECT ends_at FROM entitlements WHERE purchase_id = 'purchase'").get().ends_at,
      ends);
    assert.equal(activeFeaturedSlugs(['mine']).size, 1);
    assert.deepEqual(send('canceled', { kind: 'subscription-state', purchaseId: 'purchase',
      subscriptionId: 'sub_first', state: 'canceled', occurredAt: new Date(Date.now() + 1000).toISOString() }),
      { processed: true });
    assert.equal(activeFeaturedSlugs(['mine']).size, 1);
    assert.deepEqual(send('partial-refund-replay', { kind: 'refund', paymentId: 'txn_first',
      refundId: 'adj_first', full: false, amountMinor: 300, currency: 'usd' }), { processed: true });
    assert.equal(database.prepare("SELECT COUNT(*) AS n FROM payment_refunds WHERE payment_period_id = (SELECT id FROM payment_periods WHERE provider_payment_id = 'txn_first')").get().n, 1);
    assert.deepEqual(send('partial-refund-almost', { kind: 'refund', paymentId: 'txn_first',
      refundId: 'adj_second', full: false, amountMinor: 899, currency: 'usd' }), { processed: true });
    assert.equal(activeFeaturedSlugs(['mine']).size, 1);
    assert.deepEqual(send('partial-refund-threshold', { kind: 'refund', paymentId: 'txn_first',
      refundId: 'adj_third', full: false, amountMinor: 1, currency: 'usd' }), { processed: true });
    assert.equal(activeFeaturedSlugs(['mine']).size, 0);
    assert.equal(database.prepare("SELECT COUNT(*) AS n FROM payment_refunds WHERE payment_period_id = (SELECT id FROM payment_periods WHERE provider_payment_id = 'txn_first')").get().n, 3);
    assert.equal(database.prepare("SELECT revoked_at FROM entitlements WHERE purchase_id = 'purchase'")
      .get().revoked_at !== null, true);
    assert.deepEqual(send('paid-later', paid('txn_third', 'txn_third', starts, ends)),
      { processed: true });
    assert.equal(activeFeaturedSlugs(['mine']).size, 1);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    database.prepare("UPDATE payment_periods SET ends_at = ? WHERE provider_payment_id = 'txn_third'")
      .run(yesterday);
    database.prepare("UPDATE entitlements SET ends_at = ? WHERE purchase_id = 'purchase'")
      .run(yesterday);
    assert.equal(activeFeaturedSlugs(['mine']).size, 0);
  } finally {
    database?.close();
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});
