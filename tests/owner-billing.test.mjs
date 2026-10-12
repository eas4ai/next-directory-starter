import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('owners see only their billing and schedule supported cancellation without losing paid time', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'directory-owner-billing-'));
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = `file:${join(directory, 'catalog.db')}`;
  let database;
  try {
    ({ database } = await import('../src/lib/database.ts'));
    const { migrateCatalog } = await import('../src/lib/catalog-migrations.ts');
    const { listOwnerBilling, cancelOwnerPurchase } = await import('../src/lib/owner-billing.ts');
    migrateCatalog();
    database.prepare('INSERT INTO categories (name) VALUES (?)').run('Tools');
    database.prepare(`INSERT INTO listings
      (slug, name, summary, description, category, url, status, owner_user_id)
      VALUES ('mine', 'Mine', 'Summary', 'Description', 'Tools', 'https://example.org', 'published', 'owner')`).run();
    database.prepare(`INSERT INTO publishing_plans
      (key, name, description, mode, billing_mode, amount_minor, currency,
        duration_days, featured, enabled, updated_at)
      VALUES ('monthly', 'Monthly', '', 'test', 'monthly', 1200, 'usd', NULL, 1, 1, ?)`).run(new Date().toISOString());
    const make = (id, ownerId, status, subscriptionId) => database.prepare(`INSERT INTO purchases
      (id, listing_slug, owner_user_id, plan_key, plan_mode, billing_mode, plan_name,
        plan_description, amount_minor, currency, duration_days, accepted_duration_days,
        featured, stripe_session_id, status, created_at, provider, provider_subscription_id)
      VALUES (?, 'mine', ?, 'monthly', 'test', 'monthly', 'Monthly', '',
        1200, 'usd', 0, NULL, 1, ?, ?, ?, 'stripe', ?)`)
      .run(id, ownerId, `pending:${id}`, status, new Date().toISOString(), subscriptionId);
    make('mine-paid', 'owner', 'paid', 'sub_mine');
    make('mine-pending', 'owner', 'pending', null);
    make('other-paid', 'other', 'paid', 'sub_other');
    const paidUntil = new Date(Date.now() + 29 * 86_400_000).toISOString();
    database.prepare(`INSERT INTO entitlements
      (purchase_id, listing_slug, starts_at, ends_at, featured, revoked_at)
      VALUES (?, 'mine', ?, ?, 1, NULL)`).run(
        'mine-paid', new Date().toISOString(), paidUntil,
      );
    assert.deepEqual(listOwnerBilling('owner').map((row) => row.id).sort(),
      ['mine-paid', 'mine-pending']);
    assert.deepEqual(listOwnerBilling('other').map((row) => row.id), ['other-paid']);
    assert.equal(listOwnerBilling('owner').find((row) => row.id === 'mine-paid').status, 'paid');
    assert.equal(listOwnerBilling('owner').find((row) => row.id === 'mine-pending').status, 'pending');
    let calls = 0;
    const fake = async (provider, mode, subscriptionId) => {
      calls += 1;
      assert.deepEqual([provider, mode, subscriptionId], ['stripe', 'test', 'sub_mine']);
    };
    await assert.rejects(cancelOwnerPurchase('other', 'mine-paid', fake), /Purchase not found/);
    await assert.rejects(cancelOwnerPurchase('owner', 'mine-pending', fake), /does not support/);
    assert.equal(calls, 0);
    assert.deepEqual(await cancelOwnerPurchase('owner', 'mine-paid', fake),
      { status: 'cancel-scheduled' });
    assert.equal(calls, 1);
    assert.deepEqual(await cancelOwnerPurchase('owner', 'mine-paid', fake),
      { status: 'cancel-scheduled' });
    assert.equal(calls, 1);
    const row = listOwnerBilling('owner').find((item) => item.id === 'mine-paid');
    assert.equal(row.status, 'cancel-scheduled');
    assert.equal(row.benefitActive, true);
    assert.equal(row.paidUntil, paidUntil);
    assert.equal(row.canCancel, false);
    assert.equal(row.cancellationKind, null);
  } finally {
    database?.close();
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});
