import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Stripe from 'stripe';

test('confirmed Stripe checkout expiry releases only the terminal reservation', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'directory-checkout-expiry-'));
  const names = ['DATABASE_URL', 'SITE_URL', 'BILLING_ENCRYPTION_KEY',
    'BILLING_CHECKOUT_MODE', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  process.env.DATABASE_URL = `file:${join(directory, 'directory.db')}`;
  process.env.SITE_URL = 'https://directory.example';
  process.env.BILLING_ENCRYPTION_KEY = randomBytes(32).toString('base64url');
  process.env.BILLING_CHECKOUT_MODE = 'test';
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_WEBHOOK_SECRET;
  let database;
  try {
    ({ database } = await import('../src/lib/database.ts'));
    const { migrateCatalog } = await import('../src/lib/catalog-migrations.ts');
    const { createPlan, planByKey, planOfferToken } = await import('../src/lib/plans.ts');
    const { saveBillingProfile } = await import('../src/lib/billing-profiles.ts');
    const { createHostedCheckout } = await import('../src/lib/hosted-checkout.ts');
    const { stripeEffect } = await import('../src/lib/payment-normalizers.ts');
    const { reconcilePurchase } = await import('../src/lib/payment-reconciliation.ts');
    const { listOwnerBilling, cancelOwnerPurchase } = await import('../src/lib/owner-billing.ts');
    const { POST } = await import('../src/app/api/webhooks/stripe/route.ts');
    migrateCatalog();
    database.prepare('INSERT INTO categories (name) VALUES (?)').run('Tools');
    database.prepare(`INSERT INTO listings
      (slug, name, summary, description, category, url, status, owner_user_id)
      VALUES ('mine', 'Mine', 'Summary', 'Description', 'Tools',
        'https://example.org', 'published', 'owner')`).run();
    for (const [key, billingMode, amountMinor] of [
      ['monthly-featured', 'monthly', 1200],
      ['annual-featured', 'annual', 12000],
    ]) {
      createPlan({ key, name: key, description: `${key} terms`, mode: 'test', billingMode,
        amountMinor, currency: 'usd', durationDays: null, featured: true, enabled: true }, 'admin');
    }
    saveBillingProfile({
      provider: 'stripe', mode: 'test', version: 0, enabled: true,
      publicKey: 'pk_test_fixture', apiKey: 'sk_test_fixture',
      webhookSecret: 'whsec_expired_fixture',
      priceMappings: [
        { planKey: 'monthly-featured', priceId: 'price_monthly' },
        { planKey: 'annual-featured', priceId: 'price_annual' },
      ],
    }, 'admin');
    const token = (key) => planOfferToken(planByKey(key));
    let providerCalls = 0;
    const fakeSession = async () => {
      providerCalls += 1;
      return { resourceId: `cs_${providerCalls}`,
        url: `https://checkout.stripe.com/c/pay/cs_${providerCalls}` };
    };
    const firstInput = { planKey: 'monthly-featured', offerToken: token('monthly-featured'),
      provider: 'stripe', requestId: randomUUID() };
    const first = await createHostedCheckout('owner', 'mine', firstInput, fakeSession);
    const created = Math.floor(Date.now() / 1000);
    const expiredEvent = {
      id: 'evt_expired', object: 'event', type: 'checkout.session.expired', created,
      livemode: false, data: { object: {
        object: 'checkout.session', id: 'cs_1', client_reference_id: first.purchaseId,
        mode: 'subscription', payment_status: 'unpaid', metadata: { purchaseId: first.purchaseId },
      } },
    };
    assert.deepEqual(stripeEffect(expiredEvent), {
      kind: 'checkout-terminal', purchaseId: first.purchaseId, resourceId: 'cs_1',
      state: 'expired', occurredAt: new Date(created * 1000).toISOString(),
    });
    const stripe = new Stripe('sk_test_fixture');
    const send = (event) => {
      const body = JSON.stringify(event);
      const signature = stripe.webhooks.generateTestHeaderString({
        payload: body, secret: 'whsec_expired_fixture',
      });
      return POST(new Request('https://directory.example/api/webhooks/stripe', {
        method: 'POST', body, headers: { 'stripe-signature': signature },
      }));
    };
    const wrongResource = { ...expiredEvent, id: 'evt_expired_wrong_resource',
      data: { object: { ...expiredEvent.data.object, id: 'cs_other' } } };
    assert.equal((await send(wrongResource)).status, 202);
    assert.equal(database.prepare(`SELECT checkout_terminal_state FROM purchases
      WHERE id = ?`).get(first.purchaseId).checkout_terminal_state, null);
    assert.equal((await send(expiredEvent)).status, 200);
    assert.equal((await send(expiredEvent)).status, 200);
    assert.deepEqual(database.prepare(`SELECT checkout_terminal_state, checkout_terminal_at,
      checkout_url FROM purchases WHERE id = ?`).get(first.purchaseId), {
      checkout_terminal_state: 'expired',
      checkout_terminal_at: new Date(created * 1000).toISOString(),
      checkout_url: null,
    });
    const expiredBilling = listOwnerBilling('owner').find(({ id }) => id === first.purchaseId);
    assert.deepEqual([expiredBilling.status, expiredBilling.checkoutUrl,
      expiredBilling.canCancel, expiredBilling.cancellationKind],
    ['expired', null, false, null]);
    await assert.rejects(createHostedCheckout('owner', 'mine', firstInput, fakeSession),
      /checkout request has ended/i);

    const second = await createHostedCheckout('owner', 'mine', {
      ...firstInput, requestId: randomUUID(),
    }, fakeSession);
    assert.notEqual(second.purchaseId, first.purchaseId);
    assert.equal(second.url, 'https://checkout.stripe.com/c/pay/cs_2');
    const pendingBilling = listOwnerBilling('owner').find(({ id }) => id === second.purchaseId);
    assert.deepEqual([pendingBilling.status, pendingBilling.canCancel,
      pendingBilling.cancellationKind], ['pending', true, 'checkout']);
    let subscriptionCalls = 0;
    let expiryCalls = 0;
    const fakeSubscriptionCancel = async () => { subscriptionCalls += 1; };
    const fakeCheckoutExpiry = async (mode, resourceId, purchaseId) => {
      expiryCalls += 1;
      assert.deepEqual([mode, resourceId, purchaseId], ['test', 'cs_2', second.purchaseId]);
      return { occurredAt: new Date(created * 1000 + 500).toISOString() };
    };
    assert.deepEqual(await cancelOwnerPurchase('owner', second.purchaseId,
      fakeSubscriptionCancel, fakeCheckoutExpiry), { status: 'expired' });
    assert.deepEqual(await cancelOwnerPurchase('owner', second.purchaseId,
      fakeSubscriptionCancel, fakeCheckoutExpiry), { status: 'expired' });
    assert.deepEqual([subscriptionCalls, expiryCalls], [0, 1]);

    const third = await createHostedCheckout('owner', 'mine', {
      planKey: 'annual-featured', offerToken: token('annual-featured'),
      provider: 'stripe', requestId: randomUUID(),
    }, fakeSession);
    const reconciledAt = new Date(created * 1000 + 1000).toISOString();
    const inspectExpired = async () => [{
      provider: 'stripe', mode: 'test', eventId: 'reconcile:stripe:session-expired:cs_3',
      eventType: 'reconcile.session-expired', raw: { purchaseId: third.purchaseId, resource: 'cs_3' },
      effect: { kind: 'checkout-terminal', purchaseId: third.purchaseId,
        resourceId: 'cs_3', state: 'expired', occurredAt: reconciledAt },
    }];
    assert.deepEqual(await reconcilePurchase(third.purchaseId, 1, inspectExpired), {
      purchaseId: third.purchaseId, found: 1, processed: 1, unresolved: 0,
    });
    assert.deepEqual(database.prepare(`SELECT checkout_terminal_state, checkout_terminal_at
      FROM purchases WHERE id = ?`).get(third.purchaseId), {
      checkout_terminal_state: 'expired', checkout_terminal_at: reconciledAt,
    });
    assert.equal(providerCalls, 3);

    database.prepare(`INSERT INTO purchases
      (id, listing_slug, owner_user_id, plan_key, plan_mode, billing_mode, plan_name,
        plan_description, amount_minor, currency, duration_days, accepted_duration_days,
        featured, stripe_session_id, checkout_request_id, status, created_at, provider,
        provider_resource_id, provider_price_id)
      VALUES ('historical', 'mine', 'owner', 'monthly-featured', 'test', 'monthly',
        'Monthly', '', 1200, 'usd', 0, NULL, 1, 'cs_historical', 'historical-request',
        'pending', ?, 'stripe', 'cs_historical', 'price_monthly')`).run(new Date().toISOString());
    const historicalCreated = created - 60;
    const historicalRaw = { id: 'evt_historical_expired', object: 'event',
      type: 'checkout.session.expired', created: historicalCreated, livemode: false,
      data: { object: { object: 'checkout.session', id: 'cs_historical',
        client_reference_id: 'historical' } } };
    database.prepare(`INSERT INTO payment_evidence
      (provider, mode, event_id, event_type, payload, state, attempts, received_at, processed_at)
      VALUES ('stripe', 'test', 'evt_historical_expired', 'checkout.session.expired', ?,
        'processed', 1, ?, ?)`).run(
      JSON.stringify({ raw: historicalRaw, effect: { kind: 'noop' } }),
      new Date(historicalCreated * 1000).toISOString(),
      new Date(historicalCreated * 1000).toISOString(),
    );
    database.prepare('DELETE FROM catalog_migrations WHERE version = 26').run();
    migrateCatalog();
    assert.deepEqual(database.prepare(`SELECT checkout_terminal_state, checkout_terminal_at,
      checkout_url FROM purchases WHERE id = 'historical'`).get(), {
      checkout_terminal_state: 'expired',
      checkout_terminal_at: new Date(historicalCreated * 1000).toISOString(),
      checkout_url: null,
    });
  } finally {
    database?.close();
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});
