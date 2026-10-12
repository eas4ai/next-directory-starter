import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Stripe from 'stripe';

test('Stripe reconciliation restores outcome associations and duplicate evidence fills gaps', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'directory-stripe-reconciliation-'));
  const names = ['DATABASE_URL', 'BILLING_CHECKOUT_MODE', 'BILLING_ENCRYPTION_KEY',
    'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  const fetchBefore = globalThis.fetch;
  process.env.DATABASE_URL = `file:${join(directory, 'catalog.db')}`;
  process.env.BILLING_CHECKOUT_MODE = 'test';
  process.env.BILLING_ENCRYPTION_KEY = randomBytes(32).toString('base64url');
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_WEBHOOK_SECRET;
  let database;
  try {
    ({ database } = await import('../src/lib/database.ts'));
    const { migrateCatalog } = await import('../src/lib/catalog-migrations.ts');
    const { saveBillingProfile } = await import('../src/lib/billing-profiles.ts');
    const { retainVerifiedEvidence } = await import('../src/lib/payment-lifecycle.ts');
    const { reconcilePurchase } = await import('../src/lib/payment-reconciliation.ts');
    const { activeFeaturedSlugs } = await import('../src/lib/listings.ts');
    const { POST } = await import('../src/app/api/webhooks/stripe/route.ts');
    migrateCatalog();
    database.exec('CREATE TABLE IF NOT EXISTS "user" (id TEXT PRIMARY KEY, banned INTEGER NOT NULL DEFAULT 0)');
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
        'Monthly', '', 1200, 'usd', 0, NULL, 1, 'cs_recovered', 'pending', ?,
        'stripe', 'cs_recovered', 'sub_recovered', 'price_month')`).run(new Date().toISOString());
    saveBillingProfile({ provider: 'stripe', mode: 'test', version: 0, enabled: false,
      apiKey: 'sk_test_fixture', webhookSecret: 'whsec_recovered_fixture' }, 'admin');

    const periodStart = Math.floor(Date.now() / 1000) - 60;
    const periodEnd = periodStart + 30 * 86_400;
    const paidEffect = {
      kind: 'paid', purchaseId: 'purchase', resourceId: 'in_recovered',
      paymentId: 'in_recovered', subscriptionId: 'sub_recovered',
      priceId: 'price_month', amountMinor: 1200, currency: 'usd',
      periodStart: new Date(periodStart * 1000).toISOString(),
      periodEnd: new Date(periodEnd * 1000).toISOString(),
    };
    assert.deepEqual(retainVerifiedEvidence({ provider: 'stripe', mode: 'test',
      eventId: 'reconcile:stripe:invoice:in_recovered', eventType: 'reconcile.invoice',
      raw: { purchaseId: 'purchase', resource: 'in_recovered' }, effect: paidEffect }),
    { processed: true });

    const reply = (data) => new Response(JSON.stringify(data), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname === '/v1/checkout/sessions/cs_recovered') return reply({
        id: 'cs_recovered', object: 'checkout.session', client_reference_id: 'purchase',
        subscription: 'sub_recovered', payment_status: 'paid',
        line_items: { object: 'list', data: [{ quantity: 1, price: { id: 'price_month' } }] },
      });
      if (url.pathname === '/v1/invoices') return reply({ object: 'list', has_more: false, data: [{
        id: 'in_recovered', object: 'invoice', status: 'paid', amount_paid: 1200,
        currency: 'usd',
        lines: { object: 'list', data: [{ amount: 1200, currency: 'usd',
          pricing: { type: 'price_details', price_details: { price: 'price_month' } },
          period: { start: periodStart, end: periodEnd } }] },
        payments: { object: 'list', data: [{ payment: {
          type: 'payment_intent', payment_intent: 'pi_recovered',
        } }] },
      }] });
      if (url.pathname === '/v1/charges') return reply({ object: 'list', has_more: false,
        data: [{ id: 'ch_recovered', object: 'charge', amount: 1200,
          amount_refunded: 0, currency: 'usd', refunded: false }] });
      if (url.pathname === '/v1/disputes') return reply({ object: 'list', has_more: false,
        data: [{ id: 'dp_recovered', object: 'dispute', status: 'won', created: 100 }] });
      throw new Error(`Unexpected Stripe request: ${url.pathname}`);
    };

    assert.deepEqual(await reconcilePurchase('purchase', 5), {
      purchaseId: 'purchase', found: 3, processed: 3, unresolved: 0,
    });
    assert.deepEqual(database.prepare(`SELECT provider_payment_id,
      provider_payment_intent_id, provider_charge_id FROM payment_periods
      WHERE purchase_id = 'purchase'`).get(), {
      provider_payment_id: 'in_recovered',
      provider_payment_intent_id: 'pi_recovered',
      provider_charge_id: 'ch_recovered',
    });

    const stripe = new Stripe('sk_test_fixture');
    const send = async (event) => {
      const body = JSON.stringify(event);
      const signature = stripe.webhooks.generateTestHeaderString({
        payload: body, secret: 'whsec_recovered_fixture',
      });
      return POST(new Request('https://directory.example/api/webhooks/stripe', {
        method: 'POST', body, headers: { 'stripe-signature': signature },
      }));
    };
    const event = (id, type, object, created) => ({ id, type, object: 'event', livemode: false,
      created, data: { object } });
    assert.equal((await send(event('evt_dispute_open_stale', 'charge.dispute.created', {
      id: 'dp_recovered', object: 'dispute', charge: 'ch_recovered', status: 'needs_response',
    }, 200))).status, 200);
    assert.deepEqual([...activeFeaturedSlugs(['mine'])], ['mine']);
    assert.equal((await send(event('evt_dispute_open', 'charge.dispute.created', {
      id: 'dp_second', object: 'dispute', charge: 'ch_recovered', status: 'needs_response',
    }, 300))).status, 200);
    assert.deepEqual([...activeFeaturedSlugs(['mine'])], []);
    assert.equal((await send(event('evt_dispute_won', 'charge.dispute.closed', {
      id: 'dp_second', object: 'dispute', charge: 'ch_recovered', status: 'won',
    }, 400))).status, 200);
    assert.deepEqual([...activeFeaturedSlugs(['mine'])], ['mine']);
    assert.equal((await send(event('evt_refund', 'charge.refunded', {
      object: 'charge', id: 'ch_recovered', payment_intent: 'pi_recovered',
      amount: 1200, amount_refunded: 1200, refunded: true, currency: 'usd',
    }, 500))).status, 200);
    assert.deepEqual([...activeFeaturedSlugs(['mine'])], []);
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
