import { createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { startAccountMail } from './account-test-mail.mjs';

const ids = ['COM-004', 'COM-005'];
const results = Object.fromEntries(ids.map((id) => [id, false]));
const workspace = mkdtempSync(join(tmpdir(), 'directory-payment-foundation-'));
const databasePath = join(workspace, 'directory.db');
const password = randomBytes(20).toString('hex');
const secretMarker = `fixture-${randomBytes(12).toString('hex')}`;
let origin;
let appEnv;
let app;
let mail;
let adminCookie;
let ownerCookie;

function command(args) {
  const result = spawnSync('npm', args, { env: appEnv, encoding: 'utf8', timeout: 120_000 });
  if (result.status !== 0) throw new Error(`npm ${args[1] ?? args[0]} exited ${result.status}: ${(result.stderr ?? '').slice(-800)}`);
}

function reveal(ciphertext, provider, mode, field) {
  if (!ciphertext?.startsWith('v1:')) throw new Error('A billing secret has no encrypted envelope.');
  const payload = Buffer.from(ciphertext.slice(3), 'base64url');
  if (payload.length < 29) throw new Error('A billing secret has an invalid encrypted envelope.');
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(appEnv.BILLING_ENCRYPTION_KEY, 'base64url'),
    payload.subarray(0, 12));
  decipher.setAAD(Buffer.from(`${provider}:${mode}:${field}`));
  decipher.setAuthTag(payload.subarray(12, 28));
  return Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]).toString('utf8');
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function startApp() {
  app = spawn('npm', ['run', 'start', '--', '-p', new URL(origin).port], {
    env: appEnv, detached: true, stdio: 'ignore',
  });
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (app.exitCode !== null) break;
    try {
      const response = await fetch(origin, { signal: AbortSignal.timeout(1000) });
      if (response.status < 500) return;
    } catch { /* wait for startup */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Production server did not start.');
}

async function stopApp() {
  if (!app) return;
  const child = app;
  try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already stopped */ }
  if (child.exitCode === null) {
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 2_000)),
    ]);
  }
  app = undefined;
  await new Promise((resolve) => setTimeout(resolve, 300));
}

const request = (path, options = {}) => fetch(new URL(path, origin), { redirect: 'manual', ...options });
const cookieFrom = (response) => response.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
const json = (body, cookie, method = 'POST') => ({
  method,
  headers: { 'Content-Type': 'application/json', Origin: origin,
    ...(cookie ? { Cookie: cookie } : {}) },
  body: JSON.stringify(body),
});
const offerToken = (plan) => createHash('sha256').update(JSON.stringify([
  plan.key, plan.name, plan.description, plan.mode, plan.billingMode,
  plan.amountMinor, plan.currency, plan.durationDays, plan.featured,
])).digest('hex');

async function signIn(email) {
  const response = await request('/api/auth/sign-in/email', json({ email, password }));
  const cookie = cookieFrom(response);
  if (!response.ok || !cookie) throw new Error(`Sign-in failed for ${email}: ${response.status}.`);
  return cookie;
}

async function ensureOwner() {
  if (ownerCookie) return ownerCookie;
  const email = 'payment-owner@example.invalid';
  const before = mail.count();
  const signup = await request('/api/auth/sign-up/email', json({ email, password, name: 'Payment Owner' }));
  if (!signup.ok || cookieFrom(signup)) throw new Error('Owner signup bypassed verification or failed.');
  const verified = await request(await mail.link(email, before));
  if (verified.status >= 400) throw new Error('Owner email verification failed.');
  ownerCookie = await signIn(email);
  return ownerCookie;
}

async function approvedListing(slug) {
  const cookie = await ensureOwner();
  const created = await request('/api/owner/listings', json({
    slug, name: 'Payment foundation fixture', summary: 'A reviewed test listing.',
    description: 'An approved listing used to check plan selection.',
    category: 'Tools', url: 'https://example.org/payment-foundation',
  }, cookie));
  if (created.status !== 201) throw new Error(`Owner fixture creation returned ${created.status}.`);
  const submitted = await request(`/api/owner/listings/${slug}/submit`, json({}, cookie));
  const submission = (await submitted.json())?.submission;
  if (!submitted.ok || !submission?.id) throw new Error('Owner fixture submission failed.');
  const approved = await request(`/api/admin/submissions/${submission.id}/decision`,
    json({ decision: 'approve', reason: 'Valid payment fixture' }, adminCookie));
  if (!approved.ok) throw new Error('Owner fixture approval failed.');
  return cookie;
}

async function check(id, run) {
  try { await run(); results[id] = true; }
  catch (error) { process.stderr.write(`${id}: ${error.message}\n`); }
}

try {
  mail = await startAccountMail();
  origin = `http://127.0.0.1:${await freePort()}`;
  appEnv = {
    ...process.env, ...mail.env, CI: '1',
    DATABASE_URL: `file:${databasePath}`,
    BETTER_AUTH_SECRET: randomBytes(32).toString('hex'),
    BETTER_AUTH_URL: origin, SITE_URL: origin,
    BILLING_ENCRYPTION_KEY: randomBytes(32).toString('base64url'),
    BILLING_CHECKOUT_MODE: 'test',
  };
  command(['run', 'db:migrate']);
  command(['run', 'db:seed']);
  command(['run', 'build']);
  command(['run', 'account:provision', '--', '--email', 'payment-admin@example.invalid',
    '--password', password, '--role', 'admin', '--yes']);
  await startApp();
  adminCookie = await signIn('payment-admin@example.invalid');

  await check('COM-004', async () => {
    const free = await request('/api/admin/plans', json({
      key: 'free-basic', name: 'Free Basic', description: 'Ordinary publication.',
      mode: 'test', billingMode: 'free', amountMinor: 0, currency: 'usd', durationDays: null,
      featured: false, enabled: true,
    }, adminCookie));
    if (free.status !== 201) throw new Error(`A zero-cost free plan was rejected (HTTP ${free.status}).`);
    const monthly = await request('/api/admin/plans', json({
      key: 'monthly-featured', name: 'Monthly Featured', description: 'Featured each paid month.',
      mode: 'test', billingMode: 'monthly', amountMinor: 1200, currency: 'usd', durationDays: null,
      featured: true, enabled: true,
    }, adminCookie));
    if (monthly.status !== 201) throw new Error(`A monthly plan was rejected (HTTP ${monthly.status}).`);
    const annual = await request('/api/admin/plans', json({
      key: 'annual-featured', name: 'Annual Featured', description: 'Featured each paid year.',
      mode: 'test', billingMode: 'annual', amountMinor: 12000, currency: 'usd', durationDays: null,
      featured: true, enabled: true,
    }, adminCookie));
    if (annual.status !== 201) throw new Error(`An annual plan was rejected (HTTP ${annual.status}).`);
    const once = await request('/api/admin/plans', json({
      key: 'single-featured', name: 'Single Featured', description: 'Thirty days of placement.',
      mode: 'test', billingMode: 'one-time', amountMinor: 900, currency: 'usd', durationDays: 30,
      featured: true, enabled: true,
    }, adminCookie));
    if (once.status !== 201) throw new Error(`A one-time plan was rejected (HTTP ${once.status}).`);
    const disabled = await request('/api/admin/plans', json({
      key: 'hidden-monthly', name: 'Hidden Monthly', description: 'Should not be offered.',
      mode: 'test', billingMode: 'monthly', amountMinor: 1500, currency: 'usd', durationDays: null,
      featured: false, enabled: false,
    }, adminCookie));
    if (disabled.status !== 201) throw new Error('Disabled plan could not be saved.');
    const live = await request('/api/admin/plans', json({
      key: 'live-only', name: 'Live Only', description: 'Wrong checkout mode.',
      mode: 'live', billingMode: 'one-time', amountMinor: 1300, currency: 'usd', durationDays: 30,
      featured: false, enabled: true,
    }, adminCookie));
    if (live.status !== 201) throw new Error('Live-mode plan could not be saved.');
    const all = await request('/api/admin/plans', { headers: { Cookie: adminCookie } });
    const planRows = (await all.json())?.plans;
    const terms = (key) => planRows?.find((plan) => plan.key === key);
    if (!all.ok || terms('free-basic')?.billingMode !== 'free' ||
        terms('free-basic')?.amountMinor !== 0 || terms('free-basic')?.durationDays !== null ||
        terms('monthly-featured')?.mode !== 'test' || terms('monthly-featured')?.billingMode !== 'monthly' ||
        terms('monthly-featured')?.amountMinor !== 1200 || terms('monthly-featured')?.durationDays !== null ||
        terms('annual-featured')?.billingMode !== 'annual' ||
        terms('annual-featured')?.amountMinor !== 12000 || terms('annual-featured')?.durationDays !== null ||
        terms('single-featured')?.billingMode !== 'one-time' ||
        terms('single-featured')?.durationDays !== 30 || terms('live-only')?.mode !== 'live') {
      throw new Error('Saved free, one-time, monthly, annual, or mode-specific plan terms differ from the administrator input.');
    }
    const owner = await approvedListing('payment-foundation-entry');
    const ordinary = await request('/listings/payment-foundation-entry');
    if (!ordinary.ok) throw new Error('Approval no longer publishes the free ordinary listing.');
    const plansPage = await request('/owner/listings/payment-foundation-entry/plans',
      { headers: { Cookie: owner } });
    const html = await plansPage.text();
    const rendered = html.replace(/<!--.*?-->/g, '');
    if (!plansPage.ok || !html.includes('Free Basic') || !html.includes('Monthly Featured') ||
        !html.includes('Annual Featured') || !html.includes('Single Featured') ||
        !rendered.includes('$12.00 / month') || !rendered.includes('$120.00 / year') ||
        !html.includes('Monthly renewal') || !html.includes('Annual renewal') ||
        !html.includes('30 days') || html.includes('Hidden Monthly') ||
        html.includes('Live Only')) {
      throw new Error('The owner cannot review eligible free and recurring terms by mode.');
    }
    const displayedFreeToken = offerToken(terms('free-basic'));
    const changedBeforeAcceptance = await request('/api/admin/plans/free-basic',
      json({ name: 'Free Basic Unseen Edit' }, adminCookie, 'PATCH'));
    if (!changedBeforeAcceptance.ok) throw new Error('Could not set up the stale free-offer probe.');
    const staleAcceptance = await request('/api/owner/listings/payment-foundation-entry/plans/free',
      json({ planKey: 'free-basic', offerToken: displayedFreeToken }, owner));
    if (staleAcceptance.status !== 409) {
      throw new Error(`A stale free offer was accepted (HTTP ${staleAcceptance.status}).`);
    }
    const restoredFreePlan = await request('/api/admin/plans/free-basic',
      json({ name: 'Free Basic' }, adminCookie, 'PATCH'));
    if (!restoredFreePlan.ok) throw new Error('Could not restore the free offer.');
    const accepted = await request('/api/owner/listings/payment-foundation-entry/plans/free',
      json({ planKey: 'free-basic', offerToken: displayedFreeToken }, owner));
    if (!accepted.ok || (await accepted.text()).includes('checkout.stripe.com')) {
      throw new Error('Free selection failed or started a provider checkout.');
    }
    const planChange = await request('/api/admin/plans/free-basic',
      json({ name: 'Free Basic Edited', featured: true }, adminCookie, 'PATCH'));
    if (!planChange.ok) throw new Error('Plan terms cannot be edited.');
    const purchase = new Database(databasePath);
    try {
      const retained = purchase.prepare(`SELECT plan_name, plan_description, plan_mode, billing_mode,
        amount_minor, currency, accepted_duration_days, featured FROM purchases
        WHERE listing_slug = ? AND plan_key = ? ORDER BY created_at DESC LIMIT 1`)
        .get('payment-foundation-entry', 'free-basic');
      if (!retained || retained.plan_name !== 'Free Basic' ||
          retained.plan_description !== 'Ordinary publication.' || retained.plan_mode !== 'test' ||
          retained.billing_mode !== 'free' || retained.amount_minor !== 0 ||
          retained.currency !== 'usd' || retained.accepted_duration_days !== null ||
          retained.featured !== 0) {
        throw new Error('Free purchase terms changed with the plan or were not recorded.');
      }
    } finally { purchase.close(); }
  });

  await check('COM-005', async () => {
    const adminRead = await request('/api/admin/billing/profiles', { headers: { Cookie: adminCookie } });
    if (!adminRead.ok) throw new Error(`Protected billing profile controls are unavailable (HTTP ${adminRead.status}).`);
    const deniedRead = await request('/api/admin/billing/profiles');
    if (![401, 403].includes(deniedRead.status)) {
      throw new Error(`Guest billing profile read returned ${deniedRead.status}.`);
    }
    const saved = await request('/api/admin/billing/profiles', json({
      provider: 'stripe', mode: 'test', enabled: false, version: 0,
      publicKey: 'pk_test_fixture', apiKey: `sk_test_${secretMarker}`,
      webhookSecret: `whsec_${secretMarker}`,
      priceMappings: [{ planKey: 'mapped-plan', priceId: 'price_test_fixture' }],
    }, adminCookie, 'PUT'));
    if (!saved.ok) throw new Error(`Protected billing profile save returned ${saved.status}.`);
    const savedBody = await saved.text();
    const read = await request('/api/admin/billing/profiles', { headers: { Cookie: adminCookie } });
    const readBody = await read.text();
    if (!readBody.includes('price_test_fixture')) {
      throw new Error('Mode-specific Stripe price mapping is absent.');
    }
    const live = await request('/api/admin/billing/profiles', json({
      provider: 'stripe', mode: 'live', enabled: false, version: 0,
      publicKey: 'pk_live_fixture', apiKey: `sk_live_${secretMarker}`,
      webhookSecret: `whsec_live_${secretMarker}`,
      priceMappings: [{ planKey: 'mapped-plan', priceId: 'price_live_fixture' }],
    }, adminCookie, 'PUT'));
    if (!live.ok) throw new Error('Live-mode Stripe profile could not be saved separately.');
    const both = await request('/api/admin/billing/profiles', { headers: { Cookie: adminCookie } });
    const bothBody = await both.text();
    if (!bothBody.includes('price_test_fixture') || !bothBody.includes('price_live_fixture')) {
      throw new Error('Test and live price mappings are not separate.');
    }
    await stopApp();
    await startApp();
    const persisted = await request('/api/admin/billing/profiles', { headers: { Cookie: adminCookie } });
    const persistedBody = await persisted.text();
    if (!persisted.ok || !persistedBody.includes('price_test_fixture') ||
        !persistedBody.includes('price_live_fixture')) {
      throw new Error('Provider profiles did not survive restart.');
    }
    const rawDatabase = new Database(databasePath);
    try {
      const rows = rawDatabase.prepare('SELECT * FROM billing_profiles').all();
      if (!read.ok || savedBody.includes(secretMarker) || bothBody.includes(secretMarker) ||
          JSON.stringify(rows).includes(secretMarker)) {
        throw new Error('A saved billing secret was returned or stored as plaintext.');
      }
      const testRow = rows.find((row) => row.provider === 'stripe' && row.mode === 'test');
      const liveRow = rows.find((row) => row.provider === 'stripe' && row.mode === 'live');
      if (!testRow || !liveRow ||
          reveal(testRow.api_key_cipher, 'stripe', 'test', 'apiKey') !== `sk_test_${secretMarker}` ||
          reveal(testRow.webhook_secret_cipher, 'stripe', 'test', 'webhookSecret') !== `whsec_${secretMarker}` ||
          reveal(liveRow.api_key_cipher, 'stripe', 'live', 'apiKey') !== `sk_live_${secretMarker}` ||
          reveal(liveRow.webhook_secret_cipher, 'stripe', 'live', 'webhookSecret') !== `whsec_live_${secretMarker}`) {
        throw new Error('Saved secrets are not authenticated encryption scoped to their provider and mode.');
      }
      let wrongModeRejected = false;
      try { reveal(testRow.api_key_cipher, 'stripe', 'live', 'apiKey'); }
      catch { wrongModeRejected = true; }
      if (!wrongModeRejected) throw new Error('A test secret can be opened in live mode.');
    } finally { rawDatabase.close(); }
    const deniedWrite = await request('/api/admin/billing/profiles', json({
      provider: 'stripe', mode: 'live', enabled: true, version: 0,
    }, undefined, 'PUT'));
    if (![401, 403].includes(deniedWrite.status)) throw new Error('Guest changed billing configuration.');
    const stale = await request('/api/admin/billing/profiles', json({
      provider: 'stripe', mode: 'test', enabled: false, version: 0,
    }, adminCookie, 'PUT'));
    if (stale.status !== 409) throw new Error('A stale settings update overwrote a newer profile.');
    const incomplete = await request('/api/admin/billing/profiles', json({
      provider: 'paddle', mode: 'test', enabled: true, version: 0,
      apiKey: 'pdl_sdbx_apikey_fixture',
    }, adminCookie, 'PUT'));
    if (incomplete.status !== 400) throw new Error('An incomplete provider profile was enabled.');
    for (const mode of ['test', 'live']) {
      const now = await request('/api/admin/billing/profiles', json({
        provider: 'nowpayments', mode, enabled: false, version: 0,
        apiKey: `now_${mode}_${secretMarker}`, webhookSecret: `now_webhook_${mode}_${secretMarker}`,
        priceMappings: [],
      }, adminCookie, 'PUT'));
      if (!now.ok) throw new Error(`NOWPayments ${mode} profile could not be saved.`);
    }
    const oneTime = await request('/api/admin/plans', json({
      key: 'billing-profile-once', name: 'Billing Profile Once', description: 'Profile availability check.',
      mode: 'test', billingMode: 'one-time', amountMinor: 500, currency: 'usd',
      durationDays: 14, featured: false, enabled: true,
    }, adminCookie));
    if (oneTime.status !== 201) throw new Error('One-time billing profile fixture could not be created.');
    const owner = await approvedListing('billing-profile-entry');
    const active = await request('/api/admin/billing/profiles', json({
      provider: 'stripe', mode: 'test', enabled: true, version: 1,
    }, adminCookie, 'PUT'));
    if (!active.ok) throw new Error('Complete Stripe profile could not be enabled.');
    const offered = await request('/owner/listings/billing-profile-entry/plans', { headers: { Cookie: owner } });
    if (!offered.ok || !(await offered.text()).includes('Continue to Stripe Checkout')) {
      throw new Error('Enabled test profile did not offer one-time checkout.');
    }
    const inactive = await request('/api/admin/billing/profiles', json({
      provider: 'stripe', mode: 'test', enabled: false, version: 2,
    }, adminCookie, 'PUT'));
    if (!inactive.ok) throw new Error('Stripe profile could not be disabled.');
    const withheld = await request('/owner/listings/billing-profile-entry/plans', { headers: { Cookie: owner } });
    const withheldHtml = await withheld.text();
    if (!withheld.ok || withheldHtml.includes('Continue to Stripe Checkout') ||
        !withheldHtml.includes('Checkout is unavailable for the selected mode.')) {
      throw new Error('A disabled test profile was still offered for one-time checkout.');
    }
    const page = await request('/admin/billing', { headers: { Cookie: adminCookie } });
    if (!page.ok || !(await page.text()).includes('Stripe')) {
      throw new Error('No protected provider settings page exists.');
    }
  });
} catch (error) {
  process.stderr.write(`Payment foundation setup: ${error.message}\n`);
} finally {
  await stopApp();
  if (mail) await mail.close();
  rmSync(workspace, { recursive: true, force: true });
  for (const [id, ok] of Object.entries(results)) {
    process.stdout.write(`sudus: ${id}: ${ok ? 'pass' : 'fail'}\n`);
  }
}
