import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('refund migration backfills processed Paddle adjustments and revokes a fully refunded period', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'directory-paddle-refund-migration-'));
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = `file:${join(directory, 'catalog.db')}`;
  let database;
  try {
    ({ database } = await import('../src/lib/database.ts'));
    const { migrateCatalog } = await import('../src/lib/catalog-migrations.ts');
    migrateCatalog();
    database.prepare('INSERT INTO categories (name) VALUES (?)').run('Tools');
    database.prepare(`INSERT INTO listings
      (slug, name, summary, description, category, url, status, owner_user_id)
      VALUES ('mine', 'Mine', 'Summary', 'Description', 'Tools',
        'https://example.org', 'published', 'owner')`).run();
    database.prepare(`INSERT INTO publishing_plans
      (key, name, description, mode, billing_mode, amount_minor, currency,
        duration_days, featured, enabled, updated_at)
      VALUES ('once', 'Once', '', 'test', 'one-time', 1200, 'usd', 30, 1, 1, ?)`).run(
      new Date().toISOString(),
    );
    const now = new Date();
    const ends = new Date(now.getTime() + 30 * 86_400_000).toISOString();
    database.prepare(`INSERT INTO purchases
      (id, listing_slug, owner_user_id, plan_key, plan_mode, billing_mode, plan_name,
        plan_description, amount_minor, currency, duration_days, accepted_duration_days,
        featured, stripe_session_id, status, created_at, provider,
        provider_resource_id, provider_price_id)
      VALUES ('purchase', 'mine', 'owner', 'once', 'test', 'one-time', 'Once', '',
        1200, 'usd', 30, 30, 1, 'pending:purchase', 'paid', ?, 'paddle',
        'txn_paid', 'pri_once')`).run(now.toISOString());
    database.prepare(`INSERT INTO payment_periods
      (id, purchase_id, provider, provider_payment_id, amount_minor, currency,
        starts_at, ends_at)
      VALUES ('period', 'purchase', 'paddle', 'txn_paid', 1200, 'usd', ?, ?)`)
      .run(now.toISOString(), ends);
    database.prepare(`INSERT INTO entitlements
      (purchase_id, listing_slug, starts_at, ends_at, featured, revoked_at)
      VALUES ('purchase', 'mine', ?, ?, 1, NULL)`).run(now.toISOString(), ends);

    database.exec(`DROP TABLE payment_refunds;
      DELETE FROM catalog_migrations WHERE version = 24;`);
    const save = database.prepare(`INSERT INTO payment_evidence
      (provider, mode, event_id, event_type, payload, state, attempts,
        received_at, processed_at)
      VALUES ('paddle', 'test', ?, 'adjustment.updated', ?, 'processed', 1, ?, ?)`);
    const payload = (id, amount) => JSON.stringify({
      raw: { event_id: `event-${id}`, event_type: 'adjustment.updated', data: {
        id, action: 'refund', status: 'approved', type: 'partial',
        transaction_id: 'txn_paid', currency_code: 'USD', totals: { total: String(amount) },
      } },
      effect: { kind: 'refund', paymentId: 'txn_paid', full: false,
        amountMinor: amount, currency: 'USD' },
    });
    save.run('event-one', payload('adj_one', 600), now.toISOString(), now.toISOString());
    save.run('event-two', payload('adj_two', 600), now.toISOString(), now.toISOString());
    save.run('reconcile-one', JSON.stringify({
      raw: { purchaseId: 'purchase', resource: 'adj_one:approved' },
      effect: { kind: 'refund', paymentId: 'txn_paid', full: false,
        amountMinor: 600, currency: 'USD' },
    }), now.toISOString(), now.toISOString());

    migrateCatalog();
    migrateCatalog();
    assert.equal(database.prepare('SELECT COUNT(*) AS n FROM payment_refunds').get().n, 2);
    assert.notEqual(database.prepare("SELECT refunded_at FROM payment_periods WHERE id = 'period'")
      .get().refunded_at, null);
    assert.notEqual(database.prepare("SELECT revoked_at FROM entitlements WHERE purchase_id = 'purchase'")
      .get().revoked_at, null);
    assert.equal(database.prepare("SELECT status FROM purchases WHERE id = 'purchase'")
      .get().status, 'refunded');
    assert.equal(database.prepare(`SELECT COUNT(*) AS n FROM catalog_migrations
      WHERE version = 24`).get().n, 1);
  } finally {
    database?.close();
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});
