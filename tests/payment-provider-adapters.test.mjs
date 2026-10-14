import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('provider SDK recovery reads payments and confirms supported cancellation', async () => {
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
    const { cancelOwnerPurchase } = await import('../src/lib/owner-billing.ts');
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
    purchase('stripe-expired', 'stripe', 'cs_expired', 'price_once');
    purchase('stripe-cancel', 'stripe', 'cs_cancel', 'price_once');
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
      database.prepare(`INSERT INTO purchases
        (id, listing_slug, owner_user_id, plan_key, plan_mode, billing_mode, plan_name,
          plan_description, amount_minor, currency, duration_days, accepted_duration_days,
          featured, stripe_session_id, checkout_request_id, status, created_at,
          provider, provider_price_id)
        VALUES ('paddle-early', 'mine', 'owner', 'once', 'test', 'one-time', 'Once', '',
          1200, 'usd', 30, 30, 1, 'pending:paddle-early', 'paddle-request',
          'pending', ?, 'paddle', 'pri_once')`).run(new Date().toISOString());
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
          url.pathname === '/v1/checkout/sessions/cs_expired' ||
          url.pathname === '/v1/checkout/sessions/cs_early' ||
          url.pathname === '/v1/checkout/sessions/cs_legacy') {
        const early = url.pathname.endsWith('cs_early');
        const legacy = url.pathname.endsWith('cs_legacy');
        const expired = url.pathname.endsWith('cs_expired');
        return reply({
        id: early ? 'cs_early' : legacy ? 'cs_legacy' : expired ? 'cs_expired' : 'cs_stripe',
        object: 'checkout.session', status: expired ? 'expired' : 'complete',
        expires_at: Math.floor(Date.now() / 1000),
        client_reference_id: early ? 'stripe-early' : legacy ? 'stripe-legacy' :
          expired ? 'stripe-expired' : 'stripe-purchase',
        payment_status: expired ? 'unpaid' : 'paid',
        payment_intent: expired ? null : early ? 'pi_early' : legacy ? 'pi_legacy' : 'pi_stripe',
        amount_total: 1200,
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
          url.pathname === '/transactions/txn_paddle_refunds' ||
          url.pathname === '/transactions/txn_paddle_wrong') {
        const withRefunds = url.pathname.endsWith('_refunds');
        const wrongPurchase = url.pathname.endsWith('_wrong');
        const disputeAt = new Date(Date.now() - 1000).toISOString();
        return reply({ data: {
          id: withRefunds ? 'txn_paddle_refunds' :
            wrongPurchase ? 'txn_paddle_wrong' : 'txn_paddle',
          custom_data: { purchaseId: wrongPurchase ? 'other-purchase' :
            withRefunds ? 'paddle-refunds' : 'paddle-purchase' },
          status: 'completed', currency_code: 'USD',
          created_at: new Date().toISOString(), items: [{ quantity: 1,
            price: { id: 'pri_once', unit_price: { amount: '1200', currency_code: 'USD' },
              quantity: { minimum: 1, maximum: 100 } } }],
          payments: [], details: { tax_rates_used: [], line_items: [],
            totals: { grand_total: '1200', currency_code: 'USD' } },
          adjustments: wrongPurchase ? [] : withRefunds ? [
            { id: 'adj_reconcile_one', action: 'refund', status: 'approved',
              currency_code: 'USD', totals: { total: '600' }, items: [{ type: 'partial' }] },
            { id: 'adj_reconcile_two', action: 'refund', status: 'approved',
              currency_code: 'USD', totals: { total: '600' }, items: [{ type: 'partial' }] },
          ] : [{ id: 'adj_chargeback_reconciled', action: 'chargeback', status: 'reversed',
            currency_code: 'USD', created_at: disputeAt, updated_at: disputeAt,
            customer_id: 'ctm_fixture', reason: 'reconciled', credit_applied_to_balance: false,
            totals: null, payout_totals: null, items: [] }],
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
        purchaseId: id, found: id === 'paddle-purchase' ? 2 : 1,
        processed: id === 'paddle-purchase' ? 2 : 1, unresolved: 0,
      });
    }
    assert.deepEqual(await reconcilePurchase('stripe-expired', 5), {
      purchaseId: 'stripe-expired', found: 1, processed: 1, unresolved: 0,
    });
    assert.equal(database.prepare(`SELECT checkout_terminal_state FROM purchases
      WHERE id = 'stripe-expired'`).get().checkout_terminal_state, 'expired');
    assert.deepEqual(database.prepare(`SELECT open, terminal FROM payment_disputes
      WHERE provider = 'paddle' AND provider_dispute_id = 'adj_chargeback_reconciled'`).get(), {
      open: 0, terminal: 1,
    });
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
      await assert.rejects(
        reconcilePurchase('paddle-early', 5, undefined, 'txn_paddle_wrong'),
        /does not match the reserved purchase/,
      );
      assert.deepEqual(database.prepare(`SELECT provider_resource_id, provider_subscription_id, status
        FROM purchases WHERE id = 'paddle-early'`).get(), {
        provider_resource_id: null, provider_subscription_id: null, status: 'pending',
      });
      assert.equal(database.prepare(`SELECT COUNT(*) AS n FROM payment_evidence
        WHERE provider = 'paddle' AND event_id LIKE '%txn_paddle_wrong%'`).get().n, 0);
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

      purchase('now-paged', 'nowpayments', 'invoice_paged', null);
      const periodStart = Math.floor(Date.now() / 1000) - 60;
      const paddleRows = [
        { id: 'txn_paddle_newer', start: periodStart + 30 * 86_400,
          end: periodStart + 60 * 86_400 },
        { id: 'txn_paddle_older', start: periodStart, end: periodStart + 30 * 86_400 },
      ];
      const paddleAfter = [];
      const nowPages = [];
      const paddleTransaction = (row, subscriptionId) => ({
        id: row.id, status: 'completed', currency_code: 'USD',
          custom_data: { purchaseId: 'paddle-purchase' },
        created_at: new Date(row.start * 1000).toISOString(),
        subscription_id: subscriptionId,
        billing_period: { starts_at: new Date(row.start * 1000).toISOString(),
          ends_at: new Date(row.end * 1000).toISOString() },
        items: [{ quantity: 1, price: { id: 'pri_once',
          unit_price: { amount: '1200', currency_code: 'USD' },
          quantity: { minimum: 1, maximum: 100 } } }],
        payments: [], details: { tax_rates_used: [], line_items: [],
          totals: { grand_total: '1200', currency_code: 'USD' } },
        adjustments: [],
      });
      globalThis.fetch = async (input) => {
        const url = new URL(String(input));
        if (url.pathname === '/transactions/txn_paddle') return reply({ data: {
          ...paddleTransaction({ id: 'txn_paddle', start: periodStart,
            end: periodStart + 30 * 86_400 }, null),
          billing_period: null,
        } });
        if (url.pathname === '/transactions') {
          const after = url.searchParams.get('after');
          paddleAfter.push(after);
          const index = after === null ? 0 :
            paddleRows.findIndex(({ id }) => id === after) + 1;
          const row = paddleRows[index];
          return reply({ data: row ? [paddleTransaction(row, 'sub_paddle')] : [], meta: {
            request_id: 'fixture', pagination: { per_page: 1,
              next: '', has_more: index < paddleRows.length - 1,
              estimated_total: paddleRows.length },
          } });
        }
        if (url.pathname === '/v1/auth') return reply({ token: 'fixture.jwt.token' });
        if (url.pathname === '/v1/payment/') {
          const page = Number(url.searchParams.get('page'));
          nowPages.push(page);
          return reply({ data: [{ payment_id: 'pay_paged', invoice_id: 'invoice_paged',
            payment_status: page === 0 ? 'waiting' : 'finished', order_id: 'now-paged',
            price_amount: 12, price_currency: 'USD' }], limit: 1, page, total: 2 });
        }
        throw new Error(`Unexpected pagination request: ${url.pathname}`);
      };
      for (let run = 0; run < 2; run += 1) {
        assert.deepEqual(await reconcilePurchase('paddle-purchase', 1), {
          purchaseId: 'paddle-purchase', found: 1, processed: 1, unresolved: 0,
        });
      }
      assert.deepEqual(paddleAfter, [null, 'txn_paddle_newer']);
      assert.deepEqual(database.prepare(`SELECT provider_payment_id FROM payment_periods
        WHERE purchase_id = 'paddle-purchase' ORDER BY starts_at`).all(), [
        { provider_payment_id: 'txn_paddle_older' },
        { provider_payment_id: 'txn_paddle' },
        { provider_payment_id: 'txn_paddle_newer' },
      ]);
      assert.deepEqual(await reconcilePurchase('now-paged', 1), {
        purchaseId: 'now-paged', found: 0, processed: 0, unresolved: 0,
      });
      assert.deepEqual(await reconcilePurchase('now-paged', 1), {
        purchaseId: 'now-paged', found: 1, processed: 1, unresolved: 0,
      });
      assert.deepEqual(nowPages, [0, 1]);
      assert.equal(database.prepare(`SELECT COUNT(*) AS count
        FROM payment_reconciliation_cursors
        WHERE purchase_id IN ('paddle-purchase', 'now-paged')`).get().count, 0);

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
      if (url.pathname === '/v1/checkout/sessions/cs_cancel/expire') return reply({
        id: 'cs_cancel', object: 'checkout.session', status: 'expired',
        client_reference_id: 'stripe-cancel', expires_at: Math.floor(Date.now() / 1000),
      });
      throw new Error(`Unexpected cancellation request: ${method} ${url.pathname}`);
    };
    assert.deepEqual(await cancelOwnerPurchase('owner', 'stripe-purchase'),
      { status: 'cancel-scheduled' });
    assert.deepEqual(await cancelOwnerPurchase('owner', 'paddle-purchase'),
      { status: 'cancel-scheduled' });
    assert.deepEqual(await cancelOwnerPurchase('owner', 'stripe-cancel'),
      { status: 'expired' });
    assert.equal(requested.includes('POST /v1/subscriptions/sub_stripe'), true);
    assert.equal(requested.includes('POST /subscriptions/sub_paddle/cancel'), true);
    assert.equal(requested.includes('POST /v1/checkout/sessions/cs_cancel/expire'), true);
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
