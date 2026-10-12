import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('provider SDK recovery reads existing payments and cancellation schedules only', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'directory-provider-adapters-'));
  const names = ['DATABASE_URL', 'BILLING_ENCRYPTION_KEY', 'NOWPAYMENTS_EMAIL',
    'NOWPAYMENTS_PASSWORD'];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  const fetchBefore = globalThis.fetch;
  process.env.DATABASE_URL = `file:${join(directory, 'catalog.db')}`;
  process.env.BILLING_ENCRYPTION_KEY = randomBytes(32).toString('base64url');
  process.env.NOWPAYMENTS_EMAIL = 'fixture@example.invalid';
  process.env.NOWPAYMENTS_PASSWORD = 'fixture-password';
  let database;
  try {
    ({ database } = await import('../src/lib/database.ts'));
    const { migrateCatalog } = await import('../src/lib/catalog-migrations.ts');
    const { saveBillingProfile } = await import('../src/lib/billing-profiles.ts');
    const { reconcilePurchase } = await import('../src/lib/payment-reconciliation.ts');
    const { cancelOwnerSubscription } = await import('../src/lib/owner-billing.ts');
    migrateCatalog();
    database.prepare('INSERT INTO categories (name) VALUES (?)').run('Tools');
    database.prepare(`INSERT INTO listings
      (slug, name, summary, description, category, url, status, owner_user_id)
      VALUES ('mine', 'Mine', 'Summary', 'Description', 'Tools', 'https://example.org',
        'published', 'owner')`).run();
    database.prepare(`INSERT INTO publishing_plans
      (key, name, description, mode, billing_mode, amount_minor, currency,
        duration_days, featured, enabled, updated_at)
      VALUES ('once', 'Once', '', 'test', 'one-time', 1200, 'usd', 30, 1, 1, ?)`).run(
      new Date().toISOString(),
    );
    const purchase = (id, provider, resource, price) => database.prepare(`INSERT INTO purchases
      (id, listing_slug, owner_user_id, plan_key, plan_mode, billing_mode, plan_name,
        plan_description, amount_minor, currency, duration_days, accepted_duration_days,
        featured, stripe_session_id, status, created_at, provider,
        provider_resource_id, provider_price_id)
      VALUES (?, 'mine', 'owner', 'once', 'test', 'one-time', 'Once', '',
        1200, 'usd', 30, 30, 1, ?, 'pending', ?, ?, ?, ?)`)
      .run(id, `pending:${id}`, new Date().toISOString(), provider, resource, price);
    purchase('stripe-purchase', 'stripe', 'cs_stripe', 'price_once');
    purchase('paddle-purchase', 'paddle', 'txn_paddle', 'pri_once');
    purchase('paddle-refunds', 'paddle', 'txn_paddle_refunds', 'pri_once');
    purchase('now-purchase', 'nowpayments', 'invoice_now', null);
    database.prepare(`INSERT INTO purchases
      (id, listing_slug, owner_user_id, plan_key, plan_mode, billing_mode, plan_name,
        plan_description, amount_minor, currency, duration_days, accepted_duration_days,
        featured, stripe_session_id, checkout_request_id, status, created_at,
        provider, provider_price_id)
      VALUES ('stripe-early', 'mine', 'owner', 'once', 'test', 'one-time', 'Once', '',
        1200, 'usd', 30, 30, 1, 'pending:stripe-early', 'early-request',
        'pending', ?, 'stripe', 'price_once')`).run(new Date().toISOString());
    const legacyStartsAt = new Date(Date.now() - 86_400_000).toISOString();
    const legacyEndsAt = new Date(Date.now() + 29 * 86_400_000).toISOString();
    database.prepare(`INSERT INTO purchases
      (id, listing_slug, owner_user_id, plan_key, plan_mode, billing_mode, plan_name,
        plan_description, amount_minor, currency, duration_days, accepted_duration_days,
        featured, stripe_session_id, stripe_payment_intent_id, checkout_request_id,
        status, created_at, provider)
      VALUES ('stripe-legacy', 'mine', 'owner', 'once', 'test', 'one-time', 'Once', '',
        1200, 'usd', 30, 30, 1, 'cs_legacy', 'pi_legacy', 'legacy-request',
        'paid', ?, 'stripe')`).run(legacyStartsAt);
    database.prepare(`INSERT INTO entitlements
      (purchase_id, listing_slug, starts_at, ends_at, featured, revoked_at)
      VALUES ('stripe-legacy', 'mine', ?, ?, 1, NULL)`).run(legacyStartsAt, legacyEndsAt);
    for (const provider of ['stripe', 'paddle', 'nowpayments']) {
      saveBillingProfile({ provider, mode: 'test', version: 0, enabled: false,
        apiKey: provider === 'stripe' ? 'sk_test_fixture' : `test_${provider}_key`,
        webhookSecret: `${provider}_secret` }, 'admin');
    }
    const requested = [];
    const reply = (data) => new Response(JSON.stringify(data), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(String(input));
      const method = init.method ?? 'GET';
      requested.push(`${method} ${url.pathname}`);
      if (url.pathname === '/v1/checkout/sessions/cs_stripe' ||
          url.pathname === '/v1/checkout/sessions/cs_early' ||
          url.pathname === '/v1/checkout/sessions/cs_legacy') {
        const early = url.pathname.endsWith('cs_early');
        const legacy = url.pathname.endsWith('cs_legacy');
        return reply({
        id: early ? 'cs_early' : legacy ? 'cs_legacy' : 'cs_stripe', object: 'checkout.session',
        client_reference_id: early ? 'stripe-early' : legacy ? 'stripe-legacy' : 'stripe-purchase',
        payment_status: 'paid',
        payment_intent: early ? 'pi_early' : legacy ? 'pi_legacy' : 'pi_stripe', amount_total: 1200,
        currency: 'usd', line_items: { object: 'list', data: [{ quantity: 1,
          price: { id: 'price_once' } }] },
        });
      }
      if (url.pathname === '/v1/charges') {
        return reply({ object: 'list', data: [], has_more: false });
      }
      if (url.pathname === '/v1/disputes') return reply({ object: 'list', data:
        url.searchParams.get('payment_intent') === 'pi_legacy'
          ? [{ id: 'dp_legacy', status: 'needs_response', created: 1 }]
          : [], has_more: false });
      if (url.pathname === '/transactions/txn_paddle' ||
          url.pathname === '/transactions/txn_paddle_refunds') {
        const withRefunds = url.pathname.endsWith('_refunds');
        return reply({ data: {
        id: withRefunds ? 'txn_paddle_refunds' : 'txn_paddle',
        status: 'completed', currency_code: 'USD',
        created_at: new Date().toISOString(), items: [{ quantity: 1,
          price: { id: 'pri_once', unit_price: { amount: '1200', currency_code: 'USD' },
            quantity: { minimum: 1, maximum: 100 } } }],
        payments: [], details: { tax_rates_used: [], line_items: [],
          totals: { grand_total: '1200', currency_code: 'USD' } },
        adjustments: withRefunds ? [
          { id: 'adj_reconcile_one', action: 'refund', status: 'approved',
            currency_code: 'USD', totals: { total: '600' }, items: [{ type: 'partial' }] },
          { id: 'adj_reconcile_two', action: 'refund', status: 'approved',
            currency_code: 'USD', totals: { total: '600' }, items: [{ type: 'partial' }] },
        ] : [],
      } });
      }
      if (url.pathname === '/v1/auth') return reply({ token: 'fixture.jwt.token' });
      if (url.pathname === '/v1/payment/') return reply({ data: [{
        payment_id: 12345, invoice_id: 'invoice_now', payment_status: 'finished',
        order_id: 'now-purchase', price_amount: 12, price_currency: 'USD',
      }], limit: 5, page: 0, total: 1 });
      throw new Error(`Unexpected SDK request: ${method} ${url.pathname}`);
    };
    for (const id of ['stripe-purchase', 'paddle-purchase', 'now-purchase']) {
      assert.deepEqual(await reconcilePurchase(id, 5), {
        purchaseId: id, found: 1, processed: 1, unresolved: 0,
      });
    }
    assert.deepEqual(await reconcilePurchase('paddle-refunds', 5), {
      purchaseId: 'paddle-refunds', found: 3, processed: 3, unresolved: 0,
    });
    assert.equal(database.prepare("SELECT status FROM purchases WHERE id = 'paddle-refunds'")
      .get().status, 'refunded');
    assert.equal(database.prepare(`SELECT COUNT(*) AS n FROM payment_refunds r
      JOIN payment_periods p ON p.id = r.payment_period_id
      WHERE p.purchase_id = 'paddle-refunds'`).get().n, 2);
    assert.deepEqual(await reconcilePurchase('stripe-early', 5, undefined, 'cs_early'), {
      purchaseId: 'stripe-early', found: 1, processed: 1, unresolved: 0,
    });
    database.prepare(`UPDATE purchases SET stripe_payment_intent_id = 'pi_other'
      WHERE id = 'stripe-legacy'`).run();
    await assert.rejects(reconcilePurchase('stripe-legacy', 5, undefined, 'cs_legacy'),
      /does not match the paid purchase/);
    assert.equal(database.prepare(`SELECT COUNT(*) AS n FROM payment_periods
      WHERE purchase_id = 'stripe-legacy'`).get().n, 0);
    database.prepare(`UPDATE purchases SET stripe_payment_intent_id = 'pi_legacy'
      WHERE id = 'stripe-legacy'`).run();
    assert.deepEqual(await reconcilePurchase('stripe-legacy', 5, undefined, 'cs_legacy'), {
      purchaseId: 'stripe-legacy', found: 2, processed: 2, unresolved: 0,
    });
    assert.equal(database.prepare("SELECT provider_resource_id FROM purchases WHERE id = 'stripe-early'")
      .get().provider_resource_id, 'cs_early');
    assert.equal(database.prepare("SELECT provider_resource_id FROM purchases WHERE id = 'stripe-legacy'")
      .get().provider_resource_id, 'cs_legacy');
    assert.deepEqual(database.prepare(`SELECT starts_at, ends_at, disputed_at IS NOT NULL AS disputed
      FROM payment_periods WHERE purchase_id = 'stripe-legacy'`).get(),
    { starts_at: legacyStartsAt, ends_at: legacyEndsAt, disputed: 1 });
    assert.deepEqual(database.prepare(`SELECT starts_at, ends_at, revoked_at IS NOT NULL AS revoked
      FROM entitlements WHERE purchase_id = 'stripe-legacy'`).get(),
    { starts_at: legacyStartsAt, ends_at: legacyEndsAt, revoked: 1 });
    assert.equal(database.prepare('SELECT COUNT(*) AS n FROM payment_periods').get().n, 6);
    assert.equal(requested.includes('GET /v1/checkout/sessions/cs_stripe'), true);
    assert.equal(requested.includes('GET /transactions/txn_paddle'), true);
    assert.equal(requested.includes('GET /v1/payment/'), true);
    assert.equal(requested.some((item) => /POST .*checkout|POST .*payment/.test(item)), false);

    for (const [id, subscription] of [
      ['stripe-purchase', 'sub_stripe'],
      ['paddle-purchase', 'sub_paddle'],
    ]) {
      database.prepare(`UPDATE purchases SET billing_mode = 'monthly',
        provider_subscription_id = ? WHERE id = ?`).run(subscription, id);
    }
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(String(input));
      const method = init.method ?? 'GET';
      requested.push(`${method} ${url.pathname}`);
      if (url.pathname === '/v1/subscriptions/sub_stripe') return reply({
        id: 'sub_stripe', object: 'subscription', cancel_at_period_end: true,
      });
      if (url.pathname === '/subscriptions/sub_paddle/cancel') return reply({ data: {
        id: 'sub_paddle', status: 'active', billing_cycle: { interval: 'month', frequency: 1 },
        items: [], scheduled_change: { action: 'cancel', effective_at: new Date().toISOString() },
      } });
      throw new Error(`Unexpected cancellation request: ${method} ${url.pathname}`);
    };
    assert.deepEqual(await cancelOwnerSubscription('owner', 'stripe-purchase'),
      { status: 'cancel-scheduled' });
    assert.deepEqual(await cancelOwnerSubscription('owner', 'paddle-purchase'),
      { status: 'cancel-scheduled' });
    assert.equal(requested.includes('POST /v1/subscriptions/sub_stripe'), true);
    assert.equal(requested.includes('POST /subscriptions/sub_paddle/cancel'), true);
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
