import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('hosted checkout reserves one immutable purchase and never retries an ambiguous create', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'directory-hosted-checkout-'));
  const names = ['DATABASE_URL', 'SITE_URL', 'BILLING_ENCRYPTION_KEY', 'BILLING_CHECKOUT_MODE'];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  process.env.DATABASE_URL = `file:${join(directory, 'directory.db')}`;
  process.env.SITE_URL = 'https://directory.example';
  process.env.BILLING_ENCRYPTION_KEY = randomBytes(32).toString('base64url');
  process.env.BILLING_CHECKOUT_MODE = 'test';
  let database;
  try {
    ({ database } = await import('../src/lib/database.ts'));
    const { migrateCatalog } = await import('../src/lib/catalog-migrations.ts');
    const { createPlan, updatePlan, planByKey, planOfferToken } = await import('../src/lib/plans.ts');
    const { saveBillingProfile, checkoutProvidersForPlan } = await import('../src/lib/billing-profiles.ts');
    const { createHostedCheckout } = await import('../src/lib/hosted-checkout.ts');
    migrateCatalog();
    database.prepare('INSERT INTO categories (name) VALUES (?)').run('Tools');
    database.prepare(`INSERT INTO listings
      (slug, name, summary, description, category, url, status, owner_user_id)
      VALUES ('mine', 'Mine', 'Summary', 'Description', 'Tools', 'https://example.org', 'published', 'owner')`).run();
    database.prepare(`INSERT INTO listings
      (slug, name, summary, description, category, url, status, owner_user_id)
      VALUES ('draft', 'Draft', 'Summary', 'Description', 'Tools', 'https://example.org', 'draft', 'owner')`).run();
    const plan = (key, billingMode, mode = 'test') => createPlan({
      key, name: key, description: `${key} terms`, mode, billingMode,
      amountMinor: 1200, currency: 'usd', durationDays: billingMode === 'one-time' ? 30 : null,
      featured: true, enabled: true,
    }, 'admin');
    plan('monthly-featured', 'monthly');
    plan('one-time-featured', 'one-time');
    plan('live-featured', 'one-time', 'live');
    const profile = (provider, mappings) => saveBillingProfile({
      provider, mode: 'test', version: 0, enabled: true,
      publicKey: provider === 'stripe' ? 'pk_test_fixture' : provider === 'paddle' ? 'test_client' : '',
      apiKey: provider === 'stripe' ? 'sk_test_fixture' : `test_${provider}_key`,
      webhookSecret: `test_${provider}_secret`,
      priceMappings: mappings,
    }, 'admin');
    profile('stripe', [{ planKey: 'monthly-featured', priceId: 'price_monthly' }]);
    profile('paddle', [{ planKey: 'monthly-featured', priceId: 'pri_monthly' },
      { planKey: 'one-time-featured', priceId: 'pri_once' }]);
    profile('nowpayments', []);
    assert.deepEqual(checkoutProvidersForPlan(planByKey('monthly-featured')), ['stripe', 'paddle']);
    assert.deepEqual(checkoutProvidersForPlan(planByKey('one-time-featured')), ['paddle', 'nowpayments']);
    assert.deepEqual(checkoutProvidersForPlan(planByKey('live-featured')), []);
    const token = (key) => planOfferToken(planByKey(key));
    const calls = [];
    const fake = async (purchase, configuration) => {
      calls.push({ purchase, provider: configuration.provider, mode: configuration.mode });
      return { resourceId: `txn_${calls.length}`, url: `https://checkout.paddle.com/pay/${calls.length}` };
    };
    const monthly = { planKey: 'monthly-featured', offerToken: token('monthly-featured'),
      provider: 'paddle', requestId: randomUUID() };
    await assert.rejects(createHostedCheckout('another', 'mine', monthly, fake), /Approved owned listing/);
    await assert.rejects(createHostedCheckout('owner', 'draft', monthly, fake), /Approved owned listing/);
    await assert.rejects(createHostedCheckout('owner', 'mine', { ...monthly, provider: 'nowpayments' }, fake),
      /Eligible publishing plan/);
    await assert.rejects(createHostedCheckout('owner', 'mine', {
      ...monthly, provider: 'stripe', planKey: 'one-time-featured',
      offerToken: token('one-time-featured'), requestId: randomUUID(),
    }, fake), /no price mapping/);
    await assert.rejects(createHostedCheckout('owner', 'mine', {
      ...monthly, planKey: 'live-featured', offerToken: token('live-featured'), requestId: randomUUID(),
    }, fake), /Eligible publishing plan/);
    assert.equal(calls.length, 0);

    const first = await createHostedCheckout('owner', 'mine', monthly, fake);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].purchase.providerPriceId, 'pri_monthly');
    assert.equal(calls[0].purchase.plan.amountMinor, 1200);
    assert.equal(calls[0].provider, 'paddle');
    assert.equal(calls[0].mode, 'test');
    const row = database.prepare('SELECT * FROM purchases WHERE id = ?').get(first.purchaseId);
    assert.equal(row.amount_minor, 1200);
    assert.equal(row.provider, 'paddle');
    assert.equal(row.provider_resource_id, 'txn_1');
    assert.equal(row.provider_price_id, 'pri_monthly');
    assert.equal(row.plan_mode, 'test');
    assert.equal(await createHostedCheckout('owner', 'mine', monthly, fake).then((value) => value.url), first.url);
    assert.equal(calls.length, 1);
    updatePlan('monthly-featured', { amountMinor: 2400, enabled: false }, 'admin');
    assert.equal(await createHostedCheckout('owner', 'mine', monthly, fake).then((value) => value.url), first.url);
    assert.equal(calls.length, 1);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM purchases WHERE checkout_request_id = ?')
      .get(monthly.requestId).count, 1);

    let ambiguousCalls = 0;
    const oneTime = { planKey: 'one-time-featured', offerToken: token('one-time-featured'),
      provider: 'nowpayments', requestId: randomUUID() };
    const ambiguous = async () => { ambiguousCalls += 1; throw new Error('socket closed after remote create'); };
    await assert.rejects(createHostedCheckout('owner', 'mine', oneTime, ambiguous), /status is unknown/);
    await assert.rejects(createHostedCheckout('owner', 'mine', oneTime, ambiguous), /Checkout is pending/);
    await assert.rejects(createHostedCheckout('owner', 'mine', {
      ...oneTime, requestId: randomUUID(),
    }, ambiguous), /Checkout is pending/);
    assert.equal(ambiguousCalls, 1);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM purchases WHERE checkout_request_id = ?')
      .get(oneTime.requestId).count, 1);
  } finally {
    database?.close();
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});
