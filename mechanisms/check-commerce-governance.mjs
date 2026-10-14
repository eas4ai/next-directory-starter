import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { startAccountMail } from './account-test-mail.mjs';

const ids = ['COM-001', 'COM-002', 'COM-003', 'ADM-001', 'ADM-002'];
const results = Object.fromEntries(ids.map((id) => [id, false]));
const workspace = mkdtempSync(join(tmpdir(), 'directory-commerce-check-'));
const databasePath = join(workspace, 'directory.db');
const webhookSecret = `whsec_${randomBytes(24).toString('hex')}`;
const planKey = 'featured-thirty';
const planInput = {
  key: planKey, name: 'Featured Thirty', description: 'Featured placement for one month.',
  amountMinor: 1200, currency: 'usd', durationDays: 30, featured: true, enabled: true,
};
let origin;
let appEnv;
let app;
let adminCookie;
let ownerCookie;
let otherCookie;
let adminId;
let ownerId;
let otherId;
let planCreated = false;
let mail;

function command(program, args) {
  return spawnSync(program, args, { env: appEnv, encoding: 'utf8', timeout: 120_000 });
}

function requireCommand(program, args) {
  const result = command(program, args);
  if (result.status !== 0) throw new Error(`${program} ${args[1] ?? args[0] ?? ''} exited ${result.status}.`);
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
  try { process.kill(-app.pid, 'SIGTERM'); } catch { /* already stopped */ }
  app = undefined;
  await new Promise((resolve) => setTimeout(resolve, 300));
}

const request = (path, options = {}) => fetch(new URL(path, origin), { redirect: 'manual', ...options });
const contains = (body, value) => body.toLowerCase().includes(value.toLowerCase());

function json(body, cookie, method = 'POST') {
  return {
    method,
    headers: {
      'Content-Type': 'application/json', Origin: origin,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  };
}

function cookieFrom(response) {
  return response.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
}

async function session(cookie) {
  const response = await request('/api/auth/get-session', { headers: { Cookie: cookie } });
  const body = await response.json();
  if (!response.ok || !body?.user?.id) throw new Error('Authenticated session has no user identity.');
  return body.user.id;
}

async function signIn(email, password) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await request('/api/auth/sign-in/email', json({ email, password }));
    if (response.status === 429) {
      await new Promise((resolve) => setTimeout(resolve, 2_500));
      continue;
    }
    const cookie = cookieFrom(response);
    if (!response.ok || !cookie) throw new Error(`Sign-in returned ${response.status}.`);
    return cookie;
  }
  throw new Error(`Sign-in rate limit persisted for ${email}.`);
}

async function signUp(email, password) {
  const before = mail.count();
  const response = await request('/api/auth/sign-up/email',
    json({ email, password, name: email.split('@')[0] }));
  if (!response.ok || cookieFrom(response)) throw new Error(`Sign-up failed or bypassed verification: ${response.status}.`);
  const verified = await request(await mail.link(email, before));
  if (verified.status >= 400) throw new Error(`Verification returned ${verified.status}.`);
  return signIn(email, password);
}

async function prepareContent() {
  const password = randomBytes(20).toString('hex');
  const adminEmail = 'commerce-admin@example.invalid';
  requireCommand('npm', ['run', 'account:provision', '--', '--email', adminEmail,
    '--password', password, '--role', 'admin', '--yes']);
  adminCookie = await signIn(adminEmail, password);
  ownerCookie = await signUp('commerce-owner@example.invalid', password);
  otherCookie = await signUp('commerce-other@example.invalid', password);
  adminId = await session(adminCookie);
  ownerId = await session(ownerCookie);
  otherId = await session(otherCookie);
  const listing = await request('/api/owner/listings', json({
    slug: 'paid-entry', name: 'Paid Entry', summary: 'An approved paid listing.',
    description: 'A listing available for a featured publishing plan.',
    category: 'Tools', url: 'https://example.org/paid-entry',
  }, ownerCookie));
  if (listing.status !== 201) throw new Error(`Owner listing setup returned ${listing.status}.`);
  const submit = await request('/api/owner/listings/paid-entry/submit', json({}, ownerCookie));
  if (!submit.ok) throw new Error(`Submission setup returned ${submit.status}.`);
  const submission = (await submit.json()).submission;
  const decision = await request(`/api/admin/submissions/${submission.id}/decision`,
    json({ decision: 'approve', reason: 'Ready for publication' }, adminCookie));
  if (!decision.ok) throw new Error(`Approval setup returned ${decision.status}.`);
}

function signedEvent(type, object, id = `evt_${randomUUID()}`) {
  const body = JSON.stringify({ id, object: 'event', type,
    created: Math.floor(Date.now() / 1000), data: { object } });
  const timestamp = Math.floor(Date.now() / 1000);
  const digest = createHmac('sha256', webhookSecret).update(`${timestamp}.${body}`).digest('hex');
  return { id, body, signature: `t=${timestamp},v1=${digest}` };
}

async function sendEvent(event, signed = true) {
  return request('/api/webhooks/stripe', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(signed ? { 'Stripe-Signature': event.signature } : {}),
    },
    body: event.body,
  });
}

function withDatabase(action) {
  const database = new Database(databasePath);
  try { return action(database); } finally { database.close(); }
}

function pendingPurchase(sessionId, paymentIntentId) {
  const id = randomUUID();
  withDatabase((database) => database.prepare(`INSERT INTO purchases
    (id, listing_slug, owner_user_id, plan_key, amount_minor, currency,
      duration_days, featured, stripe_session_id, stripe_payment_intent_id, status, created_at)
    VALUES (?, 'paid-entry', ?, ?, 1200, 'usd', 30, 1, ?, ?, 'pending', ?)`)
    .run(id, ownerId, planKey, sessionId, paymentIntentId, new Date().toISOString()));
  return id;
}

async function settle(sessionId, paymentIntentId, id) {
  const event = signedEvent('checkout.session.completed', {
    id: sessionId, object: 'checkout.session', mode: 'payment', payment_status: 'paid',
    client_reference_id: id, amount_total: 1200, currency: 'usd',
    payment_intent: paymentIntentId,
  });
  const response = await sendEvent(event);
  if (!response.ok) throw new Error(`Signed settlement returned ${response.status}.`);
  return event;
}

async function check(id, run) {
  try {
    await run();
    results[id] = true;
  } catch (error) {
    process.stderr.write(`${id}: ${error.message}\n`);
  }
}

try {
  mail = await startAccountMail();
  origin = `http://127.0.0.1:${await freePort()}`;
  appEnv = {
    ...process.env,
    ...mail.env,
    CI: '1', DATABASE_URL: `file:${databasePath}`,
    BETTER_AUTH_SECRET: randomBytes(32).toString('hex'),
    BETTER_AUTH_URL: origin, SITE_URL: origin,
    BILLING_CHECKOUT_MODE: 'test',
    STRIPE_WEBHOOK_SECRET: webhookSecret,
  };
  requireCommand('npm', ['run', 'db:migrate']);
  requireCommand('npm', ['run', 'db:seed']);
  requireCommand('npm', ['run', 'db:seed']);
  requireCommand('npm', ['run', 'build']);
  await startApp();
  await prepareContent();

  await check('COM-001', async () => {
    const created = await request('/api/admin/plans', json(planInput, adminCookie));
    if (created.status !== 201) throw new Error(`Plan creation returned ${created.status}.`);
    planCreated = true;
    const offer = await request('/owner/listings/paid-entry/plans', { headers: { Cookie: ownerCookie } });
    const html = await offer.text();
    if (!offer.ok || !contains(html, planInput.name) || !contains(html, '$12.00') ||
        !contains(html, '30 days') || !contains(html, 'Featured')) {
      throw new Error('The owner cannot see price, duration and placement before checkout.');
    }
    const checkout = command('node', ['--import', 'tsx', '--test', '--test-reporter=tap',
      'tests/stripe-checkout.test.mjs']);
    if (checkout.status !== 0 || !/^# pass [1-9]\d*$/m.test(checkout.stdout) ||
        !/^# fail 0$/m.test(checkout.stdout)) {
      throw new Error('Checkout contract with a fake Stripe client did not pass.');
    }
  });

  await check('COM-002', async () => {
    if (!planCreated) throw new Error('The publishing plan is unavailable for payment checks.');
    const purchaseId = pendingPurchase('cs_test_contract_one', 'pi_test_contract_one');
    const validUnsigned = signedEvent('checkout.session.completed', {
      id: 'cs_test_contract_one', object: 'checkout.session', mode: 'payment', payment_status: 'paid',
      client_reference_id: purchaseId, amount_total: 1200, currency: 'usd',
      payment_intent: 'pi_test_contract_one',
    });
    const unsigned = await sendEvent(validUnsigned, false);
    const beforeUnsigned = withDatabase((database) => database.prepare(
      'SELECT COUNT(*) AS count FROM entitlements WHERE purchase_id = ?').get(purchaseId).count);
    if (unsigned.status !== 400 || beforeUnsigned !== 0) {
      throw new Error('An unsigned matching payment activated or bypassed verification.');
    }
    const event = signedEvent('checkout.session.completed', {
      id: 'cs_test_wrong', object: 'checkout.session', mode: 'payment', payment_status: 'paid',
      client_reference_id: purchaseId, amount_total: 1200, currency: 'usd',
      payment_intent: 'pi_test_contract_one',
    });
    const mismatched = await sendEvent(event);
    const before = withDatabase((database) => database.prepare(
      'SELECT COUNT(*) AS count FROM entitlements WHERE purchase_id = ?').get(purchaseId).count);
    if (![400, 409, 422].includes(mismatched.status) || before !== 0) {
      throw new Error('A signed event for a different checkout activated the purchase.');
    }
    const settled = await settle('cs_test_contract_one', 'pi_test_contract_one', purchaseId);
    const replay = await sendEvent(settled);
    const distinctReplay = await settle('cs_test_contract_one', 'pi_test_contract_one', purchaseId);
    const rows = withDatabase((database) => database.prepare(
      'SELECT starts_at, ends_at, revoked_at FROM entitlements WHERE purchase_id = ?').all(purchaseId));
    if (!replay.ok || !distinctReplay || rows.length !== 1 || rows[0].revoked_at ||
        !(Date.parse(rows[0].ends_at) > Date.parse(rows[0].starts_at))) {
      throw new Error('A paid event did not grant exactly one time-bounded entitlement.');
    }
    const refunded = signedEvent('charge.refunded', {
      id: 'ch_test_contract_one', object: 'charge', payment_intent: 'pi_test_contract_one',
      amount: 1200, amount_refunded: 1200, refunded: true,
    });
    const reversal = await sendEvent(refunded);
    const revokedAt = withDatabase((database) => database.prepare(
      'SELECT revoked_at FROM entitlements WHERE purchase_id = ?').get(purchaseId)?.revoked_at);
    if (!reversal.ok || !revokedAt) throw new Error('A verified full refund did not end the entitlement.');
  });

  await check('COM-003', async () => {
    if (!planCreated) throw new Error('The featured plan is unavailable.');
    const purchaseId = pendingPurchase('cs_test_contract_featured', 'pi_test_contract_featured');
    await settle('cs_test_contract_featured', 'pi_test_contract_featured', purchaseId);
    const featured = await (await request('/listings')).text();
    const ordinary = featured.split('data-testid="ordinary-results"')[1] ?? '';
    const first = ordinary.indexOf('href="/listings/example-tool"');
    const second = ordinary.indexOf('href="/listings/paid-entry"');
    if (!featured.includes('aria-label="Featured listings"') ||
        !featured.includes('Featured') || !featured.includes('href="/listings/paid-entry"') ||
        first < 0 || second < 0 || first >= second) {
      throw new Error('Featured placement is absent, unlabelled, or changes ordinary result order.');
    }
    withDatabase((database) => database.prepare(
      "UPDATE entitlements SET ends_at = '2000-01-01T00:00:00.000Z' WHERE purchase_id = ?")
      .run(purchaseId));
    const expired = await (await request('/listings')).text();
    if (expired.includes('aria-label="Featured listings"')) {
      throw new Error('An expired entitlement remains featured.');
    }
  });

  await check('ADM-001', async () => {
    const ownerPlan = await request('/api/admin/plans', json({ ...planInput, key: 'owner-bypass' }, ownerCookie));
    const otherCheckout = await request('/api/owner/listings/paid-entry/checkout',
      json({ planKey }, otherCookie));
    const ownerRole = await request(`/api/admin/accounts/${otherId}/role`,
      json({ role: 'admin' }, ownerCookie, 'PATCH'));
    const theme = await request('/api/admin/theme', json({}, ownerCookie));
    const rolePage = await request('/admin/accounts', { headers: { Cookie: adminCookie } });
    const adminRole = await request(`/api/admin/accounts/${otherId}/role`,
      json({ role: 'editor' }, adminCookie, 'PATCH'));
    const nativeSetRole = await request('/api/auth/admin/set-role',
      json({ userId: otherId, role: 'admin' }, adminCookie));
    const nativeUpdateRole = await request('/api/auth/admin/update-user',
      json({ userId: otherId, data: { role: 'admin' } }, adminCookie));
    if (![401, 403].includes(ownerPlan.status) ||
        ![401, 403, 404].includes(otherCheckout.status) ||
        ![401, 403].includes(ownerRole.status) || ![401, 403].includes(theme.status) ||
        ![401, 403].includes(nativeSetRole.status) ||
        ![401, 403].includes(nativeUpdateRole.status) ||
        !rolePage.ok || !adminRole.ok) {
      throw new Error('Direct-request permissions or administrator role control are incomplete.');
    }
  });

  await check('ADM-002', async () => {
    if (!planCreated) throw new Error('The payment plan is unavailable for audit checks.');
    const plan = await request(`/api/admin/plans/${planKey}`,
      json({ description: 'Updated payment terms.' }, adminCookie, 'PATCH'));
    const article = await request('/api/admin/articles', json({
      slug: 'audit-article', title: 'Audit article', summary: 'An audited publication.',
      body: 'A published article.', status: 'published', tags: [],
    }, adminCookie));
    const role = await request(`/api/admin/accounts/${otherId}/role`,
      json({ role: 'moderator' }, adminCookie, 'PATCH'));
    const catalogCreate = await request('/api/admin/listings', json({
      slug: 'audit-catalog', name: 'Audit Catalog', summary: 'An audited catalog listing.',
      description: 'A published listing created by an administrator.', category: 'Tools',
      url: 'https://example.org/audit-catalog', status: 'published',
    }, adminCookie));
    const catalogCreated = catalogCreate.ok ? (await catalogCreate.json()).listing : null;
    const catalogUnpublish = await request('/api/admin/listings/audit-catalog',
      json({ status: 'draft', expectedRevision: catalogCreated?.revision }, adminCookie, 'PATCH'));
    const catalogUnpublished = catalogUnpublish.ok ? (await catalogUnpublish.json()).listing : null;
    const catalogRepublish = await request('/api/admin/listings/audit-catalog',
      json({ status: 'published', expectedRevision: catalogUnpublished?.revision }, adminCookie, 'PATCH'));

    const taxonomyCreate = await request('/api/admin/categories',
      json({ name: 'Audit unused' }, adminCookie));
    const taxonomyRename = await request('/api/admin/categories/Tools',
      json({ name: 'Audited Tools' }, adminCookie, 'PATCH'));
    const taxonomyDelete = await request('/api/admin/categories/Audit%20unused',
      json({}, adminCookie, 'DELETE'));
    const renamedListings = withDatabase((database) => database.prepare(
      "SELECT COUNT(*) AS count FROM listings WHERE category = 'Audited Tools'").get().count);
    const currentTheme = await request('/api/admin/theme', { headers: { Cookie: adminCookie } });
    const currentPreset = currentTheme.ok ? (await currentTheme.json()).preset : null;
    const themeSave = await request('/api/admin/theme', json(currentPreset, adminCookie));

    const history = await request('/api/admin/audit', { headers: { Cookie: adminCookie } });
    const events = history.ok ? (await history.json()).events : null;
    const actions = ['moderation.approve', 'article.publish', 'plan.update', 'account.role',
      'catalog.publish', 'catalog.unpublish'];
    const addedEvents = [
      ['taxonomy.category.create', 'Audit unused'],
      ['taxonomy.category.rename', 'Tools -> Audited Tools'],
      ['taxonomy.category.delete', 'Audit unused'],
      ['site.theme.save', 'site'],
    ];
    const validEvent = (event, action, target) => event.action === action &&
      event.target === target && event.actorUserId === adminId &&
      Number.isFinite(Date.parse(event.occurredAt));
    if (taxonomyCreate.status !== 201 || !taxonomyRename.ok || !taxonomyDelete.ok ||
        renamedListings < 1 || !currentTheme.ok || !themeSave.ok || !Array.isArray(events) ||
        addedEvents.some(([action, target]) =>
          !events.some((event) => validEvent(event, action, target)))) {
      throw new Error('Taxonomy or theme changes lack actor and time in audit history.');
    }
    if (!plan.ok || article.status !== 201 || !role.ok || catalogCreate.status !== 201 ||
        !catalogUnpublish.ok || !catalogRepublish.ok || !Array.isArray(events) ||
        actions.some((action) => !events.some((event) =>
          event.action === action && event.actorUserId === adminId &&
          Number.isFinite(Date.parse(event.occurredAt)))) ||
        events.filter((event) => event.action === 'catalog.publish' &&
          event.target === 'audit-catalog' && event.actorUserId === adminId).length !== 2) {
      throw new Error('Protected changes lack actor and time in audit history.');
    }
  });
} catch (error) {
  process.stderr.write(`Commerce mechanism setup: ${error.message}\n`);
} finally {
  await stopApp();
  if (mail) await mail.close();
  rmSync(workspace, { recursive: true, force: true });
  for (const [id, ok] of Object.entries(results)) {
    process.stdout.write(`sudus: ${id}: ${ok ? 'pass' : 'fail'}\n`);
  }
}
