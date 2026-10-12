import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('bounded reconciliation replays retained evidence and reads one existing purchase', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'directory-payment-reconcile-'));
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = `file:${join(directory, 'catalog.db')}`;
  let database;
  try {
    ({ database } = await import('../src/lib/database.ts'));
    const { migrateCatalog } = await import('../src/lib/catalog-migrations.ts');
    const { retainVerifiedEvidence } = await import('../src/lib/payment-lifecycle.ts');
    const { retryRetainedEvidence, reconcilePurchase } =
      await import('../src/lib/payment-reconciliation.ts');
    migrateCatalog();
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
        provider_resource_id, provider_price_id)
      VALUES ('purchase', 'mine', 'owner', 'monthly', 'test', 'monthly', 'Monthly', '',
        1200, 'usd', 0, NULL, 1, 'pending:purchase', 'pending', ?, 'paddle',
        'txn_first', 'pri_monthly')`).run(new Date().toISOString());
    const start = new Date(Date.now() - 60_000).toISOString();
    const end = new Date(Date.now() + 29 * 86_400_000).toISOString();
    const paid = (paymentId) => ({ kind: 'paid', purchaseId: 'purchase',
      resourceId: paymentId, paymentId, subscriptionId: 'sub_one',
      priceId: 'pri_monthly', amountMinor: 1200, currency: 'usd',
      periodStart: start, periodEnd: end });
    const evidence = (id, effect) => ({ provider: 'paddle', mode: 'test',
      eventId: id, eventType: 'transaction.completed', raw: { id, effect }, effect });
    assert.deepEqual(retainVerifiedEvidence(evidence('missed-renewal', paid('txn_second'))),
      { processed: false });
    assert.equal(database.prepare("SELECT state FROM payment_evidence WHERE event_id = 'missed-renewal'")
      .get().state, 'unresolved');
    assert.deepEqual(retainVerifiedEvidence(evidence('link', { kind: 'subscription-linked',
      purchaseId: 'purchase', resourceId: 'txn_first', subscriptionId: 'sub_one' })),
    { processed: true });
    assert.deepEqual(retryRetainedEvidence(5), { attempted: 1, processed: 1, unresolved: 0 });
    assert.deepEqual(retryRetainedEvidence(5), { attempted: 0, processed: 0, unresolved: 0 });
    assert.equal(database.prepare('SELECT COUNT(*) AS n FROM payment_periods').get().n, 1);
    let inspected = 0;
    const fakeReadOnlyInspector = async (purchase, limit) => {
      inspected += 1;
      assert.equal(purchase.id, 'purchase');
      assert.equal(limit, 5);
      return [evidence('authoritative-third', paid('txn_third'))];
    };
    assert.deepEqual(await reconcilePurchase('purchase', 5, fakeReadOnlyInspector),
      { purchaseId: 'purchase', found: 1, processed: 1, unresolved: 0 });
    assert.equal(inspected, 1);
    assert.equal(database.prepare('SELECT COUNT(*) AS n FROM purchases').get().n, 1);
    assert.equal(database.prepare('SELECT COUNT(*) AS n FROM payment_periods').get().n, 2);
    database.prepare(`INSERT INTO purchases
      (id, listing_slug, owner_user_id, plan_key, plan_mode, billing_mode, plan_name,
        plan_description, amount_minor, currency, duration_days, accepted_duration_days,
        featured, stripe_session_id, checkout_request_id, status, created_at,
        provider, provider_price_id)
      VALUES ('early', 'mine', 'owner', 'monthly', 'test', 'monthly', 'Monthly', '',
        1200, 'usd', 0, NULL, 1, 'pending:early', 'early-request', 'pending', ?,
        'paddle', 'pri_monthly')`).run(new Date().toISOString());
    const earlyInspector = async (purchase) => {
      assert.equal(purchase.provider_resource_id, 'txn_early');
      return [{ ...evidence('authoritative-early', { ...paid('txn_early'),
        purchaseId: 'early', subscriptionId: 'sub_early' }),
        eventId: 'authoritative-early' }];
    };
    assert.deepEqual(await reconcilePurchase('early', 5, earlyInspector, 'txn_early'),
      { purchaseId: 'early', found: 1, processed: 1, unresolved: 0 });
    assert.equal(database.prepare("SELECT provider_resource_id FROM purchases WHERE id = 'early'")
      .get().provider_resource_id, 'txn_early');
    assert.throws(() => retryRetainedEvidence(51), /limit/);
    await assert.rejects(reconcilePurchase('purchase', 0, fakeReadOnlyInspector), /limit/);
  } finally {
    database?.close();
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});
