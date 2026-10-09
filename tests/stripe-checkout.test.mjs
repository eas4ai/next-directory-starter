import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

test('Checkout reserves displayed terms and waits for delayed payment success', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'directory-checkout-contract-'));
  const previous = { database: process.env.DATABASE_URL, site: process.env.SITE_URL };
  process.env.DATABASE_URL = `file:${join(dir, 'directory.db')}`;
  process.env.SITE_URL = 'https://directory.example';
  let database;
  try {
    const storage = await import('../src/lib/database.ts');
    database = storage.database;
    const { migrateCatalog } = await import('../src/lib/catalog-migrations.ts');
    const { createPlan, updatePlan, planByKey, planOfferToken } = await import('../src/lib/plans.ts');
    const { createPublishingCheckout } = await import('../src/lib/checkout.ts');
    const { processStripeEvent } = await import('../src/lib/payment-events.ts');
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
    const displayedToken = planOfferToken(planByKey('featured-thirty'));

    const calls = [];
    const issued = new Map();
    const fakeStripe = async (settings, options) => {
      calls.push({ settings, options });
      if (!issued.has(options.idempotencyKey)) {
        issued.set(options.idempotencyKey, issued.size === 0 ? 'cs_test_approved' : `cs_test_another_${issued.size}`);
      }
      const id = issued.get(options.idempotencyKey);
      return { id, url: `https://checkout.stripe.com/c/pay/${id}` };
    };
    await assert.rejects(createPublishingCheckout('other', 'mine', 'featured-thirty', displayedToken, randomUUID(), fakeStripe),
      /Approved owned listing not found/);
    await assert.rejects(createPublishingCheckout('owner', 'draft', 'featured-thirty', displayedToken, randomUUID(), fakeStripe),
      /Approved owned listing not found/);
    assert.equal(calls.length, 0);

    const requestId = randomUUID();
    const result = await createPublishingCheckout('owner', 'mine', 'featured-thirty', displayedToken, requestId, fakeStripe);
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
    await assert.rejects(createPublishingCheckout('owner', 'mine', 'featured-thirty', displayedToken, randomUUID(), fakeStripe),
      /Plan terms changed/);
    assert.equal(calls.length, 1);
    const retried = await createPublishingCheckout('owner', 'mine', 'featured-thirty', displayedToken, requestId, fakeStripe);
    assert.equal(retried.purchaseId, result.purchaseId);
    assert.equal(calls[1].settings.line_items[0].price_data.unit_amount, 1200);
    assert.equal(calls[1].options.idempotencyKey, result.purchaseId);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM purchases WHERE checkout_request_id = ?').get(requestId).count, 1);

    database.exec(`CREATE TRIGGER reject_session_update BEFORE UPDATE OF stripe_session_id ON purchases
      BEGIN SELECT RAISE(ABORT, 'simulated local write failure'); END`);
    const interruptedId = randomUUID();
    const currentToken = planOfferToken(planByKey('featured-thirty'));
    const interruptedCalls = [];
    const interruptedStripe = async (settings, options) => {
      interruptedCalls.push({ settings, options });
      return { id: 'cs_test_interrupted', url: 'https://checkout.stripe.com/c/pay/cs_test_interrupted' };
    };
    await assert.rejects(createPublishingCheckout('owner', 'mine', 'featured-thirty', currentToken, interruptedId, interruptedStripe),
      /simulated local write failure/);
    const pending = database.prepare('SELECT * FROM purchases WHERE checkout_request_id = ?').get(interruptedId);
    assert.equal(pending.status, 'pending');
    assert.equal(pending.stripe_session_id, `pending:${pending.id}`);
    database.exec('DROP TRIGGER reject_session_update');
    const recovered = await createPublishingCheckout('owner', 'mine', 'featured-thirty', currentToken, interruptedId, interruptedStripe);
    assert.equal(recovered.purchaseId, pending.id);
    assert.equal(interruptedCalls[0].options.idempotencyKey, pending.id);
    assert.equal(interruptedCalls[1].options.idempotencyKey, pending.id);
    assert.equal(database.prepare('SELECT stripe_session_id FROM purchases WHERE id = ?').get(pending.id).stripe_session_id,
      'cs_test_interrupted');

    const session = {
      id: 'cs_test_approved', object: 'checkout.session', mode: 'payment',
      client_reference_id: result.purchaseId, amount_total: 1200, currency: 'usd',
    };
    const unpaid = { id: 'evt_unpaid', type: 'checkout.session.completed',
      data: { object: { ...session, payment_status: 'unpaid', payment_intent: null } } };
    processStripeEvent(unpaid);
    assert.equal(database.prepare('SELECT status FROM purchases WHERE id = ?').get(result.purchaseId).status, 'pending');
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM entitlements WHERE purchase_id = ?').get(result.purchaseId).count, 0);
    const paid = { id: 'evt_async_paid', type: 'checkout.session.async_payment_succeeded',
      data: { object: { ...session, payment_status: 'paid', payment_intent: 'pi_test_approved' } } };
    processStripeEvent(paid);
    processStripeEvent(paid);
    assert.equal(database.prepare('SELECT status FROM purchases WHERE id = ?').get(result.purchaseId).status, 'paid');
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM entitlements WHERE purchase_id = ?').get(result.purchaseId).count, 1);
  } finally {
    database?.close();
    if (previous.database === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous.database;
    if (previous.site === undefined) delete process.env.SITE_URL;
    else process.env.SITE_URL = previous.site;
    rmSync(dir, { recursive: true, force: true });
  }
});
