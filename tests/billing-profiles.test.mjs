import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('billing profiles encrypt secrets, isolate modes, and honor disabled and stale settings', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'directory-billing-profiles-'));
  const names = ['DATABASE_URL', 'BILLING_ENCRYPTION_KEY', 'BILLING_CHECKOUT_MODE',
    'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  process.env.DATABASE_URL = `file:${join(directory, 'catalog.db')}`;
  process.env.BILLING_ENCRYPTION_KEY = randomBytes(32).toString('base64url');
  process.env.BILLING_CHECKOUT_MODE = 'test';
  process.env.STRIPE_SECRET_KEY = 'sk_test_legacy_fixture';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_legacy_fixture';
  let database;
  try {
    ({ database } = await import('../src/lib/database.ts'));
    const { saveBillingProfile, stripeCheckoutConfiguration,
      stripeWebhookCandidates, listBillingProfiles } = await import('../src/lib/billing-profiles.ts');
    const input = (mode, version, enabled, suffix) => ({
      provider: 'stripe', mode, version, enabled, publicKey: `pk_${mode}_${suffix}`,
      apiKey: `sk_${mode}_${suffix}`, webhookSecret: `whsec_${mode}_${suffix}`,
      priceMappings: [{ planKey: 'featured', priceId: `price_${mode}_${suffix}` }],
    });
    const testProfile = saveBillingProfile(input('test', 0, true, 'saved'), 'admin');
    const liveProfile = saveBillingProfile(input('live', 0, true, 'saved'), 'admin');
    assert.equal(testProfile.version, 1);
    assert.equal(liveProfile.version, 1);
    assert.equal(JSON.stringify(listBillingProfiles()).includes('sk_test_saved'), false);
    assert.equal(JSON.stringify(database.prepare('SELECT * FROM billing_profiles').all()).includes('sk_test_saved'), false);
    assert.equal(JSON.stringify(database.prepare('SELECT * FROM billing_profiles').all()).includes('whsec_live_saved'), false);
    assert.equal(stripeCheckoutConfiguration().apiKey, 'sk_test_saved');
    process.env.BILLING_CHECKOUT_MODE = 'live';
    assert.equal(stripeCheckoutConfiguration().apiKey, 'sk_live_saved');
    assert.deepEqual(stripeWebhookCandidates().map(({ mode, secret }) => [mode, secret]).sort(),
      [['live', 'whsec_live_saved'], ['test', 'whsec_legacy_fixture'],
        ['test', 'whsec_test_saved']].sort());
    assert.throws(() => saveBillingProfile(input('live', 0, false, 'stale'), 'admin'),
      /Billing profile changed/);
    assert.throws(() => saveBillingProfile({ ...input('live', 1, true, 'wrong'),
      apiKey: 'sk_test_wrong_mode' }, 'admin'), /must match the selected checkout mode/);
    saveBillingProfile({ provider: 'stripe', mode: 'live', version: 1, enabled: false }, 'admin');
    assert.equal(stripeCheckoutConfiguration(), null);
    assert.ok(stripeWebhookCandidates().some(({ mode, secret }) =>
      mode === 'live' && secret === 'whsec_live_saved'));
    process.env.BILLING_CHECKOUT_MODE = 'test';
    assert.equal(stripeCheckoutConfiguration().apiKey, 'sk_test_saved');
    process.env.BILLING_ENCRYPTION_KEY = randomBytes(32).toString('base64url');
    assert.throws(() => stripeCheckoutConfiguration(), /cannot read the saved billing secrets/);
  } finally {
    database?.close();
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});
