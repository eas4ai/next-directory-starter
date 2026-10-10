import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('Paddle and NOWPayments signatures authenticate the exact mode and purchase', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'directory-payment-webhooks-'));
  const names = ['DATABASE_URL', 'BILLING_ENCRYPTION_KEY'];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  process.env.DATABASE_URL = `file:${join(directory, 'catalog.db')}`;
  process.env.BILLING_ENCRYPTION_KEY = randomBytes(32).toString('base64url');
  let database;
  try {
    ({ database } = await import('../src/lib/database.ts'));
    const { migrateCatalog } = await import('../src/lib/catalog-migrations.ts');
    const { saveBillingProfile } = await import('../src/lib/billing-profiles.ts');
    const { POST: paddlePost } = await import('../src/app/api/webhooks/paddle/[mode]/route.ts');
    const { POST: nowPost } = await import('../src/app/api/webhooks/nowpayments/[mode]/route.ts');
    const { createWebhookSignature } = await import('@nowpaymentsio/nowpayments-sdk-nodejs');
    migrateCatalog();
    database.prepare('INSERT INTO categories (name) VALUES (?)').run('Tools');
    database.prepare(`INSERT INTO listings
      (slug, name, summary, description, category, url, status, owner_user_id)
      VALUES ('mine', 'Mine', 'Summary', 'Description', 'Tools', 'https://example.org', 'published', 'owner')`).run();
    database.prepare(`INSERT INTO publishing_plans
      (key, name, description, mode, billing_mode, amount_minor, currency,
        duration_days, featured, enabled, updated_at)
      VALUES ('once', 'Once', '', 'test', 'one-time', 1200, 'usd', 30, 1, 1, ?)`).run(new Date().toISOString());
    const purchase = (id, provider, resource, price) => database.prepare(`INSERT INTO purchases
      (id, listing_slug, owner_user_id, plan_key, plan_mode, billing_mode, plan_name,
        plan_description, amount_minor, currency, duration_days, accepted_duration_days,
        featured, stripe_session_id, status, created_at, provider,
        provider_resource_id, provider_price_id)
      VALUES (?, 'mine', 'owner', 'once', 'test', 'one-time', 'Once', '',
        1200, 'usd', 30, 30, 1, ?, 'pending', ?, ?, ?, ?)`)
      .run(id, `pending:${id}`, new Date().toISOString(), provider, resource, price);
    purchase('paddle-purchase', 'paddle', 'txn_paddle', 'pri_once');
    purchase('now-purchase', 'nowpayments', 'invoice_now', null);
    saveBillingProfile({ provider: 'paddle', mode: 'test', version: 0, enabled: false,
      apiKey: 'test_paddle_key', webhookSecret: 'paddle_secret', priceMappings: [] }, 'admin');
    saveBillingProfile({ provider: 'nowpayments', mode: 'test', version: 0, enabled: false,
      apiKey: 'test_now_key', webhookSecret: 'now_secret', priceMappings: [] }, 'admin');

    const context = (mode) => ({ params: Promise.resolve({ mode }) });
    const request = (provider, body, signature) => new Request(`https://directory.example/api/webhooks/${provider}/test`, {
      method: 'POST', body, headers: signature ? {
        [provider === 'paddle' ? 'paddle-signature' : 'x-nowpayments-sig']: signature,
      } : {},
    });
    const paddlePayload = { event_id: 'evt_paddle', event_type: 'transaction.completed',
      data: { id: 'txn_paddle', status: 'completed', currency_code: 'USD',
        custom_data: { purchaseId: 'paddle-purchase' },
        items: [{ quantity: 1, price: { id: 'pri_once', unit_price: { amount: '1200' } } }],
        details: { totals: { grand_total: '1200' } },
      } };
    const paddleBody = JSON.stringify(paddlePayload);
    const timestamp = Math.floor(Date.now() / 1000);
    const paddleSignature = `ts=${timestamp};h1=${createHmac('sha256', 'paddle_secret')
      .update(`${timestamp}:${paddleBody}`).digest('hex')}`;
    assert.equal((await paddlePost(request('paddle', paddleBody), context('test'))).status, 400);
    assert.equal((await paddlePost(request('paddle', paddleBody, paddleSignature), context('live'))).status, 503);
    assert.equal((await paddlePost(request('paddle', paddleBody, 'ts=1;h1=bad'), context('test'))).status, 400);
    assert.equal((await paddlePost(request('paddle', paddleBody, paddleSignature), context('test'))).status, 200);
    assert.equal((await paddlePost(request('paddle', paddleBody, paddleSignature), context('test'))).status, 200);

    const nowPayload = { payment_id: 12345, invoice_id: 'invoice_now',
      payment_status: 'finished', order_id: 'now-purchase',
      price_amount: 12, price_currency: 'USD' };
    const nowBody = JSON.stringify(nowPayload);
    const nowSignature = createWebhookSignature(nowPayload, 'now_secret');
    assert.equal((await nowPost(request('nowpayments', nowBody), context('test'))).status, 400);
    assert.equal((await nowPost(request('nowpayments', nowBody, 'bad'), context('test'))).status, 400);
    assert.equal((await nowPost(request('nowpayments', nowBody, nowSignature), context('test'))).status, 200);
    assert.equal((await nowPost(request('nowpayments', nowBody, nowSignature), context('test'))).status, 200);
    assert.equal(database.prepare('SELECT COUNT(*) AS n FROM payment_periods').get().n, 2);
    assert.equal(database.prepare('SELECT COUNT(*) AS n FROM entitlements').get().n, 2);
  } finally {
    database?.close();
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});
