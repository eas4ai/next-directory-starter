import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';

const ids = ['PUB-001', 'PUB-002', 'PUB-003', 'PUB-004', 'PUB-005', 'ADM-003'];
const results = Object.fromEntries(ids.map((id) => [id, false]));
const workspace = mkdtempSync(join(tmpdir(), 'directory-owner-check-'));
let app;
let origin;
let appEnv;
let adminCookie;
let ownerACookie;
let ownerBCookie;
let moderatorCookie;

function command(args) {
  return spawnSync('npm', args, { env: appEnv, encoding: 'utf8', timeout: 120_000 });
}

function requireCommand(args) {
  const result = command(args);
  if (result.status !== 0) throw new Error(`${args.join(' ')} failed: ${result.stderr || result.stdout}`);
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
    env: appEnv,
    detached: true,
    stdio: 'ignore',
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
const contains = (html, text) => html.toLowerCase().includes(text.toLowerCase());

function json(body, cookie, method = 'POST') {
  return {
    method,
    headers: {
      'Content-Type': 'application/json',
      Origin: origin,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  };
}

function cookieFrom(response) {
  return response.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
}

async function signIn(email, password) {
  const response = await request('/api/auth/sign-in/email', json({ email, password }));
  const cookie = cookieFrom(response);
  if (!response.ok || !cookie) throw new Error(`Sign-in failed for ${email}: ${response.status}.`);
  return cookie;
}

async function signUp(email, password) {
  const response = await request('/api/auth/sign-up/email', json({ email, password, name: email.split('@')[0] }));
  const cookie = cookieFrom(response);
  if (!response.ok || !cookie) throw new Error(`Owner sign-up failed: ${response.status}.`);
  return cookie;
}

async function identities() {
  const password = randomBytes(20).toString('hex');
  const adminEmail = 'review-admin@example.invalid';
  requireCommand(['run', 'account:provision', '--', '--email', adminEmail, '--password', password, '--role', 'admin', '--yes']);
  adminCookie = await signIn(adminEmail, password);
  ownerACookie = await signUp('owner-a@example.invalid', password);
  ownerBCookie = await signUp('owner-b@example.invalid', password);
  await signUp('moderator@example.invalid', password);
  const db = new Database(join(workspace, 'directory.db'));
  try {
    db.prepare('UPDATE "user" SET role = ? WHERE email = ?').run('moderator', 'moderator@example.invalid');
  } finally {
    db.close();
  }
  moderatorCookie = await signIn('moderator@example.invalid', password);
}

function draft(slug, name = `Owner ${slug}`) {
  return {
    slug, name, summary: `Summary for ${slug}`,
    description: `Description for ${slug}`,
    category: 'Tools', url: `https://example.org/${slug}`,
  };
}

async function createDraft(slug, cookie = ownerACookie, name) {
  const response = await request('/api/owner/listings', json(draft(slug, name), cookie));
  if (response.status !== 201) throw new Error(`Owner draft creation returned ${response.status}.`);
  return response.json();
}

async function submit(slug, cookie = ownerACookie) {
  const response = await request(`/api/owner/listings/${slug}/submit`, json({}, cookie));
  if (!response.ok) throw new Error(`Submission returned ${response.status}.`);
  const body = await response.json();
  if (!body.submission?.id) throw new Error('Submission has no review identifier.');
  return body.submission.id;
}

async function decide(id, decision, reason, cookie = moderatorCookie) {
  const response = await request(`/api/admin/submissions/${id}/decision`, json({ decision, reason }, cookie));
  if (!response.ok) throw new Error(`${decision} returned ${response.status}.`);
}

async function reviewRecords() {
  const response = await request('/api/admin/submissions', { headers: { Cookie: adminCookie } });
  if (!response.ok) throw new Error(`Review queue returned ${response.status}.`);
  const body = await response.json();
  if (!Array.isArray(body.submissions)) throw new Error('Review queue has no submissions.');
  return body.submissions;
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
  origin = `http://127.0.0.1:${await freePort()}`;
  appEnv = {
    ...process.env,
    CI: '1',
    DATABASE_URL: `file:${join(workspace, 'directory.db')}`,
    BETTER_AUTH_SECRET: randomBytes(32).toString('hex'),
    BETTER_AUTH_URL: origin,
    SITE_URL: origin,
  };
  requireCommand(['run', 'db:migrate']);
  requireCommand(['run', 'build']);
  await startApp();
  await identities();

  await check('PUB-001', async () => {
    await createDraft('owned-entry');
    const signInPage = await request('/owner/sign-in');
    const ownerPage = await request('/owner/listings', { headers: { Cookie: ownerACookie } });
    if (!signInPage.ok || !contains(await signInPage.text(), 'password') ||
        !ownerPage.ok || !contains(await ownerPage.text(), 'owned-entry')) {
      throw new Error('An owner cannot sign in and manage their listing from a private workspace.');
    }
    const path = '/api/owner/listings/owned-entry';
    const otherGet = await request(path, { headers: { Cookie: ownerBCookie } });
    const otherWrite = await request(path, json({ name: 'Stolen name' }, ownerBCookie, 'PATCH'));
    const ownWrite = await request(path, json({ name: 'Owner updated name' }, ownerACookie, 'PATCH'));
    if (![403, 404].includes(otherGet.status) || ![403, 404].includes(otherWrite.status) || !ownWrite.ok) {
      throw new Error('An owner can read or edit another owner’s private listing, or cannot edit their own.');
    }
  });

  await check('PUB-002', async () => {
    await createDraft('private-entry');
    const guest = await request('/api/owner/listings/private-entry');
    const publicPage = await request('/listings/private-entry');
    const id = await submit('private-entry');
    const records = await reviewRecords();
    if (![401, 403, 404].includes(guest.status) || publicPage.status !== 404 ||
        !records.some((item) => item.id === id && item.status === 'pending')) {
      throw new Error('A draft is public or its submission is absent from review.');
    }
  });

  await check('PUB-003', async () => {
    await createDraft('rejected-entry');
    const rejectedId = await submit('rejected-entry');
    const ownerDecision = await request(`/api/admin/submissions/${rejectedId}/decision`,
      json({ decision: 'approve', reason: 'Owner bypass' }, ownerACookie));
    const noReason = await request(`/api/admin/submissions/${rejectedId}/decision`,
      json({ decision: 'reject', reason: '' }, moderatorCookie));
    if (![401, 403].includes(ownerDecision.status) || noReason.status !== 400) {
      throw new Error('An owner can decide a submission or a rejection can omit its reason.');
    }
    await decide(rejectedId, 'reject', 'Needs a clearer description');
    await createDraft('approved-entry');
    const approvedId = await submit('approved-entry');
    await decide(approvedId, 'approve', 'Useful resource');
    const records = await reviewRecords();
    const rejected = records.find((item) => item.id === rejectedId);
    const rejectedPage = await request('/listings/rejected-entry');
    const published = await request('/listings/approved-entry');
    if (!rejected || rejected.status !== 'rejected' ||
        !JSON.stringify(rejected).includes('Needs a clearer description') ||
        rejectedPage.status !== 404 || published.status !== 200) {
      throw new Error('A moderator decision lacks its reason or approval did not publish.');
    }
  });

  await check('PUB-004', async () => {
    await createDraft('revision-entry', ownerACookie, 'Approved version');
    await decide(await submit('revision-entry'), 'approve', 'Initial approval');
    const path = '/listings/revision-entry';
    const before = await (await request(path)).text();
    const edit = await request('/api/owner/listings/revision-entry',
      json({ name: 'Proposed version' }, ownerACookie, 'PATCH'));
    if (!edit.ok) throw new Error(`Owner revision returned ${edit.status}.`);
    const revisionId = await submit('revision-entry');
    const pending = await (await request(path)).text();
    if (!contains(before, 'Approved version') || !contains(pending, 'Approved version') ||
        contains(pending, 'Proposed version')) {
      throw new Error('A pending edit changed the approved public listing.');
    }
    await decide(revisionId, 'approve', 'Revision approved');
    if (!contains(await (await request(path)).text(), 'Proposed version')) {
      throw new Error('Approved revision did not become public.');
    }
  });

  await check('PUB-005', async () => {
    await createDraft('suspended-entry');
    await decide(await submit('suspended-entry'), 'approve', 'Initial approval');
    const ownerAttempt = await request('/api/admin/listings/suspended-entry/suspend',
      json({ reason: 'Owner bypass' }, ownerACookie));
    const response = await request('/api/admin/listings/suspended-entry/suspend',
      json({ reason: 'Unsafe destination' }, moderatorCookie));
    const detail = await request('/listings/suspended-entry');
    const search = await request('/listings?q=suspended-entry');
    if (![401, 403].includes(ownerAttempt.status) || !response.ok || detail.status !== 404 ||
        contains(await search.text(), 'Owner suspended-entry')) {
      throw new Error('A moderator cannot suspend immediately or the listing remains public.');
    }
  });

  await check('ADM-003', async () => {
    await createDraft('pending-review-entry');
    await submit('pending-review-entry');
    await createDraft('history-entry');
    const historyId = await submit('history-entry');
    await decide(historyId, 'reject', 'Duplicate resource');
    const history = (await reviewRecords()).find((item) => item.id === historyId);
    const page = await request('/admin/review', { headers: { Cookie: adminCookie } });
    const html = await page.text();
    const guest = await request('/admin/review');
    const hasPending = contains(html, 'pending-review-entry');
    const hasHistory = contains(html, 'Duplicate resource');
    if (!history?.decidedAt || !history?.decidedBy || !page.ok || !hasPending ||
        !hasHistory || guest.status === 200) {
      throw new Error(`Review view mismatch: page ${page.status}, pending ${hasPending}, history ${hasHistory}, guest ${guest.status}, decision ${Boolean(history?.decidedAt && history?.decidedBy)}.`);
    }
  });
} catch (error) {
  process.stderr.write(`Owner mechanism setup: ${error.message}\n`);
} finally {
  await stopApp();
  rmSync(workspace, { recursive: true, force: true });
  for (const [id, ok] of Object.entries(results)) {
    process.stdout.write(`sudus: ${id}: ${ok ? 'pass' : 'fail'}\n`);
  }
}
