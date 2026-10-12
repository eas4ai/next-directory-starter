import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Stripe from 'stripe';

test('signed Stripe hosted checkout, recurring invoice, and refund match the purchase', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'directory-stripe-hosted-'));
  const names = ['DATABASE_URL', 'BILLING_ENCRYPTION_KEY', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  process.env.DATABASE_URL = `file:${join(directory, 'catalog.db')}`;
  process.env.BILLING_ENCRYPTION_KEY = randomBytes(32).toString('base64url');
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_WEBHOOK_SECRET;
  let database;
  try {
    ({ database } = await import('../src/lib/database.ts'));
    const { migrateCatalog } = await import('../src/lib/catalog-migrations.ts');
    const { saveBillingProfile } = await import('../src/lib/billing-profiles.ts');
    const { POST } = await import('../src/app/api/webhooks/stripe/route.ts');
    migrateCatalog();
    database.prepare('INSERT INTO categories (name) VALUES (?)').run('Tools');
    database.prepare(`INSERT INTO listings
      (slug, name, summary, description, category, url, status, owner_user_id)
      VALUES ('mine', 'Mine', 'Summary', 'Description', 'Tools', 'https://example.org', 'published', 'owner')`).run();
    for (const [key, billingMode, duration] of [['once', 'one-time', 30], ['monthly', 'monthly', null]]) {
      database.prepare(`INSERT INTO publishing_plans
        (key, name, description, mode, billing_mode, amount_minor, currency,
          duration_days, featured, enabled, updated_at)
        VALUES (?, ?, '', 'test', ?, 1200, 'usd', ?, 1, 1, ?)`).run(
        key, key, billingMode, duration, new Date().toISOString(),
      );
    }
    const purchase = (id, key, billingMode, duration, session, price) => database.prepare(`INSERT INTO purchases
      (id, listing_slug, owner_user_id, plan_key, plan_mode, billing_mode, plan_name,
        plan_description, amount_minor, currency, duration_days, accepted_duration_days,
        featured, stripe_session_id, status, created_at, provider,
        provider_resource_id, provider_price_id)
      VALUES (?, 'mine', 'owner', ?, 'test', ?, ?, '', 1200, 'usd', ?, ?,
        1, ?, 'pending', ?, 'stripe', ?, ?)`)
      .run(id, key, billingMode, key, duration ?? 0, duration, session,
        new Date().toISOString(), session, price);
    purchase('once-purchase', 'once', 'one-time', 30, 'cs_once', null);
    purchase('month-purchase', 'monthly', 'monthly', null, 'cs_month', 'price_month');
    database.prepare(`INSERT INTO purchases
      (id, listing_slug, owner_user_id, plan_key, plan_mode, billing_mode, plan_name,
        plan_description, amount_minor, currency, duration_days, accepted_duration_days,
        featured, stripe_session_id, checkout_request_id, status, created_at, provider)
      VALUES ('early-purchase', 'mine', 'owner', 'once', 'test', 'one-time', 'Once', '',
        1200, 'usd', 30, 30, 1, 'pending:early-purchase', 'early-request',
        'pending', ?, 'stripe')`).run(new Date().toISOString());
    database.prepare(`INSERT INTO purchases
      (id, listing_slug, owner_user_id, plan_key, plan_mode, billing_mode, plan_name,
        plan_description, amount_minor, currency, duration_days, accepted_duration_days,
        featured, stripe_session_id, checkout_request_id, status, created_at,
        provider, provider_price_id)
      VALUES ('early-month', 'mine', 'owner', 'monthly', 'test', 'monthly', 'Monthly', '',
        1200, 'usd', 0, NULL, 1, 'pending:early-month', 'early-month-request',
        'pending', ?, 'stripe', 'price_month')`).run(new Date().toISOString());
    saveBillingProfile({ provider: 'stripe', mode: 'test', version: 0, enabled: false,
      apiKey: 'sk_test_fixture', webhookSecret: 'whsec_hosted_fixture' }, 'admin');
    const stripe = new Stripe('sk_test_fixture');
    const oversized = await POST(new Request('https://directory.example/api/webhooks/stripe', {
      method: 'POST', body: '{}',
      headers: { 'stripe-signature': 'present', 'Content-Length': '1000001' },
    }));
    assert.equal(oversized.status, 413);
    const send = async (event, secret = 'whsec_hosted_fixture') => {
      const body = JSON.stringify(event);
      const signature = stripe.webhooks.generateTestHeaderString({ payload: body, secret });
      return POST(new Request('https://directory.example/api/webhooks/stripe', {
        method: 'POST', body, headers: { 'stripe-signature': signature },
      }));
    };
    const event = (id, type, object, livemode = false) => ({
      id, type, object: 'event', livemode, created: Math.floor(Date.now() / 1000),
      data: { object },
    });
    const oneTime = event('evt_once', 'checkout.session.completed', {
      object: 'checkout.session', id: 'cs_once', mode: 'payment',
      client_reference_id: 'once-purchase', payment_status: 'paid',
      payment_intent: 'pi_once', amount_total: 1200, currency: 'usd', metadata: {},
    });
    assert.equal((await send(oneTime, 'wrong_secret')).status, 400);
    assert.equal((await send({ ...oneTime, livemode: true })).status, 400);
    assert.equal((await send(oneTime)).status, 200);
    assert.equal((await send(oneTime)).status, 200);
    const early = event('evt_early', 'checkout.session.completed', {
      ...oneTime.data.object, id: 'cs_early', client_reference_id: 'early-purchase',
      payment_intent: 'pi_early',
    });
    assert.equal((await send({ ...early, id: 'evt_early_wrong_currency',
      data: { object: { ...early.data.object, currency: 'eur' } } })).status, 202);
    assert.equal(database.prepare("SELECT provider_resource_id FROM purchases WHERE id = 'early-purchase'")
      .get().provider_resource_id, null);
    assert.equal((await send(early)).status, 200);
    assert.equal(database.prepare("SELECT provider_resource_id FROM purchases WHERE id = 'early-purchase'")
      .get().provider_resource_id, 'cs_early');
    assert.equal(database.prepare("SELECT COUNT(*) AS n FROM payment_periods WHERE purchase_id = 'early-purchase'")
      .get().n, 1);
    assert.equal(database.prepare("SELECT COUNT(*) AS n FROM payment_periods WHERE purchase_id = 'once-purchase'")
      .get().n, 1);
    const differentPayment = event('evt_once_second_payment', 'checkout.session.completed', {
      ...oneTime.data.object, payment_intent: 'pi_other',
    });
    assert.equal((await send(differentPayment)).status, 202);
    assert.equal(database.prepare("SELECT COUNT(*) AS n FROM payment_periods WHERE purchase_id = 'once-purchase'")
      .get().n, 1);
    const partial = event('evt_partial', 'charge.refunded', { object: 'charge',
      payment_intent: 'pi_once', amount: 1200, amount_refunded: 300,
      refunded: false, currency: 'usd' });
    assert.equal((await send(partial)).status, 200);
    assert.equal(database.prepare("SELECT refunded_at FROM payment_periods WHERE purchase_id = 'once-purchase'")
      .get().refunded_at, null);
    const full = event('evt_full', 'charge.refunded', { object: 'charge',
      payment_intent: 'pi_once', amount: 1200, amount_refunded: 1200,
      refunded: true, currency: 'usd' });
    assert.equal((await send(full)).status, 200);
    assert.equal(database.prepare("SELECT status FROM purchases WHERE id = 'once-purchase'").get().status,
      'refunded');

    const linked = event('evt_linked', 'checkout.session.completed', {
      object: 'checkout.session', id: 'cs_month', mode: 'subscription',
      client_reference_id: 'month-purchase', subscription: 'sub_month', payment_status: 'paid',
    });
    assert.equal((await send(linked)).status, 200);
    const earlyLinked = event('evt_early_linked', 'checkout.session.completed', {
      ...linked.data.object, id: 'cs_early_month', client_reference_id: 'early-month',
      subscription: 'sub_early_month',
    });
    assert.equal((await send(earlyLinked)).status, 200);
    assert.deepEqual(database.prepare(`SELECT provider_resource_id, provider_subscription_id
      FROM purchases WHERE id = 'early-month'`).get(), {
      provider_resource_id: 'cs_early_month', provider_subscription_id: 'sub_early_month',
    });
    const periodStart = Math.floor(Date.now() / 1000) - 60;
    const periodEnd = periodStart + 30 * 86_400;
    const invoice = event('evt_invoice', 'invoice.paid', {
      object: 'invoice', id: 'in_month', status: 'paid', subscription: 'sub_month',
      amount_paid: 1200, currency: 'usd', payment_intent: 'pi_month',
      metadata: { purchaseId: 'month-purchase' },
      lines: { data: [{ amount: 1200, currency: 'usd', price: { id: 'price_month', unit_amount: 1200 },
        period: { start: periodStart, end: periodEnd } }] },
    });
    assert.equal((await send(invoice)).status, 200);
    assert.deepEqual(database.prepare(`SELECT provider_payment_intent_id, provider_charge_id
      FROM payment_periods WHERE purchase_id = 'month-purchase'`).get(), {
      provider_payment_intent_id: 'pi_month', provider_charge_id: null,
    });
    assert.equal(database.prepare("SELECT COUNT(*) AS n FROM entitlements WHERE purchase_id = 'month-purchase'")
      .get().n, 1);
    assert.equal((await send(event('evt_dispute_open', 'charge.dispute.created', {
      object: 'dispute', payment_intent: 'pi_month', status: 'needs_response',
    }))).status, 200);
    assert.notEqual(database.prepare("SELECT disputed_at FROM payment_periods WHERE purchase_id = 'month-purchase'")
      .get().disputed_at, null);
    assert.equal((await send(event('evt_dispute_won', 'charge.dispute.closed', {
      object: 'dispute', payment_intent: 'pi_month', status: 'won',
    }))).status, 200);
    assert.equal(database.prepare("SELECT disputed_at FROM payment_periods WHERE purchase_id = 'month-purchase'")
      .get().disputed_at, null);
  } finally {
    database?.close();
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});
