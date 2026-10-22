import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('official NOWPayments SDK creates one mode-specific hosted invoice from saved terms', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'directory-nowpayments-sdk-'));
  const previousFetch = globalThis.fetch;
  const previousDatabase = process.env.DATABASE_URL;
  const previousSite = process.env.SITE_URL;
  process.env.DATABASE_URL = `file:${join(directory, 'directory.db')}`;
  process.env.SITE_URL = 'https://directory.example';
  const calls = [];
  let database;
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return Response.json({
      id: 'invoice-123', order_id: 'purchase-123',
      invoice_url: 'https://nowpayments.io/payment/?iid=invoice-123',
      price_amount: 12.5, price_currency: 'usd',
    });
  };
  try {
    ({ database } = await import('../src/lib/database.ts'));
    const { createHostedSession } = await import('../src/lib/payment-provider.ts');
    const purchase = {
      id: 'purchase-123', listingSlug: 'mine', ownerUserId: 'owner',
      plan: { key: 'one-time', name: 'One Time', billingMode: 'one-time',
        amountMinor: 1250, currency: 'usd', durationDays: 30 },
      providerPriceId: null,
    };
    const configuration = {
      provider: 'nowpayments', mode: 'test', apiKey: 'sandbox-key',
      webhookSecret: 'sandbox-ipn-secret', publicKey: '', priceMappings: [], legacy: false,
    };
    const invoice = await createHostedSession(purchase, configuration);
    assert.deepEqual(invoice, {
      resourceId: 'invoice-123', url: 'https://nowpayments.io/payment/?iid=invoice-123',
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api-sandbox.nowpayments.io/v1/invoice');
    assert.equal(calls[0].options.headers['x-api-key'], 'sandbox-key');
    const body = JSON.parse(calls[0].options.body);
    assert.equal(body.price_amount, 12.5);
    assert.equal(body.price_currency, 'usd');
    assert.equal(body.order_id, 'purchase-123');
    assert.equal(body.ipn_callback_url, 'https://directory.example/api/webhooks/nowpayments/test');
    await assert.rejects(createHostedSession({ ...purchase,
      plan: { ...purchase.plan, billingMode: 'monthly' } }, configuration), /one-time only/);
    assert.equal(calls.length, 1);
  } finally {
    database?.close();
    globalThis.fetch = previousFetch;
    if (previousDatabase === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabase;
    if (previousSite === undefined) delete process.env.SITE_URL;
    else process.env.SITE_URL = previousSite;
    rmSync(directory, { recursive: true, force: true });
  }
});
