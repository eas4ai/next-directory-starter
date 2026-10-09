import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('Checkout uses approved ownership and snapshots the displayed plan terms', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'directory-checkout-contract-'));
  const previous = { database: process.env.DATABASE_URL, site: process.env.SITE_URL };
  process.env.DATABASE_URL = `file:${join(dir, 'directory.db')}`;
  process.env.SITE_URL = 'https://directory.example';
  let database;
  try {
    const storage = await import('../src/lib/database.ts');
    database = storage.database;
    const { migrateCatalog } = await import('../src/lib/catalog-migrations.ts');
    const { createPlan, updatePlan } = await import('../src/lib/plans.ts');
    const { createPublishingCheckout } = await import('../src/lib/checkout.ts');
    migrateCatalog();
    database.prepare('INSERT INTO categories (name) VALUES (?)').run('Tools');
    database.prepare(`INSERT INTO listings
      (slug, name, summary, description, category, url, status, owner_user_id)
      VALUES ('mine', 'Mine', 'Summary', 'Description', 'Tools', 'https://example.org', 'published', 'owner')`).run();
    database.prepare(`INSERT INTO listings
      (slug, name, summary, description, category, url, status, owner_user_id)
      VALUES ('draft', 'Draft', 'Summary', 'Description', 'Tools', 'https://example.org', 'draft', 'owner')`).run();
    createPlan({ key: 'featured-thirty', name: 'Featured Thirty', description: 'Prominent listing',
      amountMinor: 1200, currency: 'usd', durationDays: 30, featured: true, enabled: true }, 'admin');

    const calls = [];
    const fakeStripe = async (settings, options) => {
      calls.push({ settings, options });
      return { id: 'cs_test_approved', url: 'https://checkout.stripe.com/c/pay/cs_test_approved' };
    };
    await assert.rejects(createPublishingCheckout('other', 'mine', 'featured-thirty', fakeStripe),
      /Approved owned listing not found/);
    await assert.rejects(createPublishingCheckout('owner', 'draft', 'featured-thirty', fakeStripe),
      /Approved owned listing not found/);
    assert.equal(calls.length, 0);

    const result = await createPublishingCheckout('owner', 'mine', 'featured-thirty', fakeStripe);
    assert.equal(result.url, 'https://checkout.stripe.com/c/pay/cs_test_approved');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].settings.mode, 'payment');
    assert.equal(calls[0].settings.client_reference_id, result.purchaseId);
    assert.equal(calls[0].settings.line_items[0].price_data.unit_amount, 1200);
    assert.equal(calls[0].settings.line_items[0].price_data.currency, 'usd');
    assert.match(calls[0].settings.line_items[0].price_data.product_data.description, /30 days.*featured/);
    assert.equal(calls[0].options.idempotencyKey, result.purchaseId);
    const row = database.prepare('SELECT * FROM purchases WHERE id = ?').get(result.purchaseId);
    assert.equal(row.owner_user_id, 'owner');
    assert.equal(row.listing_slug, 'mine');
    assert.equal(row.amount_minor, 1200);
    assert.equal(row.duration_days, 30);
    assert.equal(row.featured, 1);
    assert.equal(row.stripe_session_id, 'cs_test_approved');
    assert.equal(row.status, 'pending');

    updatePlan('featured-thirty', { amountMinor: 2500, durationDays: 60, featured: false }, 'admin');
    const stillOriginal = database.prepare('SELECT amount_minor, duration_days, featured FROM purchases WHERE id = ?').get(result.purchaseId);
    assert.deepEqual(stillOriginal, { amount_minor: 1200, duration_days: 30, featured: 1 });
  } finally {
    database?.close();
    if (previous.database === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous.database;
    if (previous.site === undefined) delete process.env.SITE_URL;
    else process.env.SITE_URL = previous.site;
    rmSync(dir, { recursive: true, force: true });
  }
});
