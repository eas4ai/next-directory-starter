import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('reconciliation shares one budget and advances retries and provider pages', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'directory-reconciliation-batching-'));
  const names = ['DATABASE_URL', 'BILLING_ENCRYPTION_KEY', 'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET'];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  const fetchBefore = globalThis.fetch;
  process.env.DATABASE_URL = `file:${join(directory, 'catalog.db')}`;
  process.env.BILLING_ENCRYPTION_KEY = randomBytes(32).toString('base64url');
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_WEBHOOK_SECRET;
  let database;
  try {
    ({ database } = await import('../src/lib/database.ts'));
    const { migrateCatalog } = await import('../src/lib/catalog-migrations.ts');
    const { saveBillingProfile } = await import('../src/lib/billing-profiles.ts');
    const { retainVerifiedEvidence } = await import('../src/lib/payment-lifecycle.ts');
    const { retryRetainedEvidence, reconcilePurchase, reconcileBilling } =
      await import('../src/lib/payment-reconciliation.ts');
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

    database.prepare('INSERT INTO categories (name) VALUES (?)').run('Tools');
    database.prepare(`INSERT INTO listings
      (slug, name, summary, description, category, url, status, owner_user_id)
      VALUES ('mine', 'Mine', 'Summary', 'Description', 'Tools',
        'https://example.org', 'published', 'owner')`).run();
    database.prepare(`INSERT INTO publishing_plans
      (key, name, description, mode, billing_mode, amount_minor, currency,
        duration_days, featured, enabled, updated_at)
      VALUES ('monthly', 'Monthly', '', 'test', 'monthly', 1200, 'usd',
        NULL, 1, 1, ?)`).run(new Date().toISOString());
    database.prepare(`INSERT INTO purchases
      (id, listing_slug, owner_user_id, plan_key, plan_mode, billing_mode,
        plan_name, plan_description, amount_minor, currency, duration_days,
        accepted_duration_days, featured, stripe_session_id, status, created_at,
        provider, provider_resource_id, provider_subscription_id, provider_price_id)
      VALUES ('purchase', 'mine', 'owner', 'monthly', 'test', 'monthly',
        'Monthly', '', 1200, 'usd', 0, NULL, 1, 'cs_batch', 'pending', ?,
        'stripe', 'cs_batch', 'sub_batch', 'price_month')`).run(new Date().toISOString());
    saveBillingProfile({ provider: 'stripe', mode: 'test', version: 0, enabled: false,
      apiKey: 'sk_test_fixture', webhookSecret: 'whsec_fixture' }, 'admin');

    const periodStart = Math.floor(Date.now() / 1000) - 60;
    const invoices = [
      { id: 'in_newer', start: periodStart + 30 * 86_400, end: periodStart + 60 * 86_400 },
      { id: 'in_older', start: periodStart, end: periodStart + 30 * 86_400 },
    ];
    const requestedAfter = [];
    const reply = (data) => new Response(JSON.stringify(data), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname === '/v1/checkout/sessions/cs_batch') return reply({
        id: 'cs_batch', object: 'checkout.session', status: 'complete',
        client_reference_id: 'purchase', subscription: 'sub_batch', payment_status: 'paid',
        line_items: { object: 'list', data: [{ quantity: 1, price: { id: 'price_month' } }] },
      });
      if (url.pathname === '/v1/invoices') {
        const after = url.searchParams.get('starting_after');
        requestedAfter.push(after);
        const index = after === null ? 0 : invoices.findIndex(({ id }) => id === after) + 1;
        const invoice = invoices[index];
        return reply({ object: 'list', has_more: index < invoices.length - 1,
          data: invoice ? [{ id: invoice.id, object: 'invoice', status: 'paid',
            amount_paid: 1200, currency: 'usd',
            lines: { object: 'list', data: [{ amount: 1200, currency: 'usd',
              pricing: { type: 'price_details', price_details: { price: 'price_month' } },
              period: { start: invoice.start, end: invoice.end } }] } }] : [] });
      }
      throw new Error(`Unexpected Stripe request: ${url.pathname}`);
    };

    for (let run = 0; run < 3; run += 1) {
      assert.deepEqual(await reconcilePurchase('purchase', 1), {
        purchaseId: 'purchase', found: 1, processed: 1, unresolved: 0,
      });
    }
    assert.deepEqual(requestedAfter, [null, 'in_newer']);
    assert.deepEqual(database.prepare(`SELECT provider_payment_id FROM payment_periods
      WHERE purchase_id = 'purchase' ORDER BY starts_at`).all(), [
      { provider_payment_id: 'in_older' }, { provider_payment_id: 'in_newer' },
    ]);

    database.prepare(`INSERT INTO payment_evidence
      (provider, mode, event_id, event_type, payload, state, attempts, received_at, next_attempt_at)
      VALUES ('stripe', 'test', 'budget-retained', 'test.noop', ?, 'unresolved', 1, ?, ?)`)
      .run(JSON.stringify({ raw: {}, effect: { kind: 'noop' } }),
        '2026-01-03T00:00:00.000Z', '2026-01-03T00:00:00.000Z');
    let inspected = 0;
    const fakeInspector = async () => { inspected += 1; return []; };
    assert.deepEqual(await reconcileBilling(1, 'purchase', undefined, fakeInspector), {
      retained: { attempted: 1, processed: 1, unresolved: 0, quarantined: 1 },
      purchase: null, purchaseDeferred: true,
    });
    assert.equal(inspected, 0);
    assert.deepEqual(await reconcileBilling(1, 'purchase', undefined, fakeInspector), {
      retained: { attempted: 0, processed: 0, unresolved: 0, quarantined: 1 },
      purchase: { purchaseId: 'purchase', found: 0, processed: 0, unresolved: 0 },
      purchaseDeferred: false,
    });
    assert.equal(inspected, 1);
  } finally {
    globalThis.fetch = fetchBefore;
    database?.close();
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});
