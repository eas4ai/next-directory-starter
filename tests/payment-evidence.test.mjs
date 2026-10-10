import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('verified evidence matches immutable terms, survives failures, and fulfills once', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'directory-payment-evidence-'));
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = `file:${join(directory, 'catalog.db')}`;
  let database;
  try {
    ({ database } = await import('../src/lib/database.ts'));
    const { migrateCatalog } = await import('../src/lib/catalog-migrations.ts');
    const { retainVerifiedEvidence } = await import('../src/lib/payment-lifecycle.ts');
    migrateCatalog();
    database.prepare('INSERT INTO categories (name) VALUES (?)').run('Tools');
    database.prepare(`INSERT INTO listings
      (slug, name, summary, description, category, url, status, owner_user_id)
      VALUES ('mine', 'Mine', 'Summary', 'Description', 'Tools', 'https://example.org', 'published', 'owner')`).run();
    database.prepare(`INSERT INTO publishing_plans
      (key, name, description, mode, billing_mode, amount_minor, currency,
        duration_days, featured, enabled, updated_at)
      VALUES ('monthly', 'Monthly', '', 'test', 'monthly', 1200, 'usd', NULL, 1, 1, ?)`).run(new Date().toISOString());
    const purchase = (id, resource) => database.prepare(`INSERT INTO purchases
      (id, listing_slug, owner_user_id, plan_key, plan_mode, billing_mode, plan_name,
        plan_description, amount_minor, currency, duration_days, accepted_duration_days,
        featured, stripe_session_id, status, created_at, provider,
        provider_resource_id, provider_price_id)
      VALUES (?, 'mine', 'owner', 'monthly', 'test', 'monthly', 'Monthly', '',
        1200, 'usd', 0, NULL, 1, ?, 'pending', ?, 'paddle', ?, 'pri_monthly')`)
      .run(id, `pending:${id}`, new Date().toISOString(), resource);
    purchase('purchase-1', 'txn_first');
    purchase('purchase-2', 'txn_second');
    const periodStart = new Date(Date.now() - 60_000).toISOString();
    const periodEnd = new Date(Date.now() + 29 * 86_400_000).toISOString();
    const effect = { kind: 'paid', purchaseId: 'purchase-1', resourceId: 'txn_first',
      paymentId: 'txn_first', subscriptionId: 'sub_first', priceId: 'pri_monthly',
      amountMinor: 1200, currency: 'usd', periodStart, periodEnd };
    const send = (id, candidate = effect, mode = 'test') => retainVerifiedEvidence({
      provider: 'paddle', mode, eventId: id, eventType: 'transaction.completed',
      raw: { id, candidate }, effect: candidate,
    });
    assert.deepEqual(send('wrong-mode', effect, 'live'), { processed: false });
    assert.deepEqual(send('wrong-price', { ...effect, priceId: 'pri_other' }), { processed: false });
    assert.deepEqual(send('wrong-amount', { ...effect, amountMinor: 100 }), { processed: false });
    assert.deepEqual(send('wrong-resource', { ...effect, resourceId: 'txn_other' }), { processed: false });
    assert.equal(database.prepare('SELECT COUNT(*) AS n FROM entitlements').get().n, 0);
    assert.equal(database.prepare("SELECT COUNT(*) AS n FROM payment_evidence WHERE state = 'unresolved'").get().n, 4);

    assert.deepEqual(send('paid-first'), { processed: true });
    assert.deepEqual(send('paid-first'), { processed: true });
    assert.equal(database.prepare('SELECT COUNT(*) AS n FROM payment_periods').get().n, 1);
    assert.equal(database.prepare('SELECT COUNT(*) AS n FROM entitlements').get().n, 1);
    assert.equal(database.prepare('SELECT state FROM subscription_states WHERE purchase_id = ?')
      .get('purchase-1').state, 'active');
    assert.equal(database.prepare('SELECT provider_subscription_id FROM purchases WHERE id = ?')
      .get('purchase-1').provider_subscription_id, 'sub_first');
    assert.deepEqual(send('reused-payment', { ...effect, purchaseId: 'purchase-2',
      resourceId: 'txn_second' }), { processed: false });
    assert.equal(database.prepare('SELECT COUNT(*) AS n FROM payment_periods').get().n, 1);

    const renewal = { ...effect, resourceId: 'txn_renewal', paymentId: 'txn_renewal',
      periodStart: periodEnd, periodEnd: new Date(Date.parse(periodEnd) + 30 * 86_400_000).toISOString() };
    assert.deepEqual(send('paid-renewal', renewal), { processed: true });
    assert.equal(database.prepare('SELECT COUNT(*) AS n FROM payment_periods').get().n, 2);
    assert.equal(database.prepare('SELECT ends_at FROM entitlements WHERE purchase_id = ?')
      .get('purchase-1').ends_at, renewal.periodEnd);
  } finally {
    database?.close();
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});
