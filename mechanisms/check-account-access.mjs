import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';

const ids = ['ACC-001', 'ACC-002', 'ACC-003', 'ACC-004'];
const results = Object.fromEntries(ids.map((id) => [id, false]));
const workspace = mkdtempSync(join(tmpdir(), 'directory-account-check-'));
const databasePath = join(workspace, 'directory.db');
const password = randomBytes(20).toString('hex');
const nextPassword = randomBytes(20).toString('hex');
const messages = [];
let mailServer;
let app;
let appEnv;
let origin;

function requireCommand(args) {
  const result = spawnSync('npm', args, { env: appEnv, encoding: 'utf8', timeout: 120_000 });
  if (result.status !== 0) {
    if (args.includes('build')) process.stderr.write(`${(result.stderr ?? '').slice(-1500)}\n`);
    throw new Error(`npm ${args[1] ?? args[0]} exited ${result.status}.`);
  }
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function startMail() {
  mailServer = createHttpServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/emails' ||
        request.headers.authorization !== 'Bearer test-resend-key') {
      response.writeHead(404).end();
      return;
    }
    let body = '';
    for await (const chunk of request) body += chunk.toString('utf8');
    const email = JSON.parse(body);
    messages.push({ to: String(email.to?.[0]).toLowerCase(), body: String(email.text ?? '') });
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ id: `test-${messages.length}` }));
  });
  await new Promise((resolve) => mailServer.listen(0, '127.0.0.1', resolve));
  return mailServer.address().port;
}

async function mailLink(address, since) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const mail = messages.slice(since).find((item) => item.to === address.toLowerCase());
    if (mail) {
      const match = mail.body.match(/https?:\/\/[^\s<>"']+/);
      if (match) return match[0];
      throw new Error('Mail arrived without an actionable URL.');
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`No account email arrived for ${address}.`);
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
const cookieFrom = (response) => response.headers.getSetCookie().map((item) => item.split(';')[0]).join('; ');
const json = (body, cookie, method = 'POST') => ({
  method,
  headers: { 'Content-Type': 'application/json', Origin: origin,
    ...(cookie ? { Cookie: cookie } : {}) },
  body: JSON.stringify(body),
});

async function signIn(email, secret = password) {
  const response = await request('/api/auth/sign-in/email', json({ email, password: secret }));
  return { response, cookie: cookieFrom(response) };
}

async function provision(email, role = 'user', markVerified = true) {
  requireCommand(['run', 'account:provision', '--', '--email', email,
    '--password', password, '--role', role, '--yes']);
  if (markVerified) {
    const db = new Database(databasePath);
    try { db.prepare('UPDATE "user" SET emailVerified = 1 WHERE email = ?').run(email); }
    finally { db.close(); }
  }
  const session = await signIn(email);
  if (!session.response.ok || !session.cookie) {
    throw new Error(`Provisioned ${role} cannot sign in (HTTP ${session.response.status}).`);
  }
  const identity = await request('/api/auth/get-session', { headers: { Cookie: session.cookie } });
  const user = (await identity.json())?.user;
  if (!user?.id) throw new Error('Provisioned account has no session identity.');
  return { ...session, id: user.id };
}

async function check(id, run) {
  try { await run(); results[id] = true; }
  catch (error) { process.stderr.write(`${id}: ${error.message}\n`); }
}

function withDb(action) {
  const db = new Database(databasePath);
  try { return action(db); } finally { db.close(); }
}

try {
  const resendPort = await startMail();
  origin = `http://127.0.0.1:${await freePort()}`;
  appEnv = {
    ...process.env, CI: '1', DATABASE_URL: `file:${databasePath}`,
    BETTER_AUTH_SECRET: randomBytes(32).toString('hex'),
    BETTER_AUTH_URL: origin, SITE_URL: origin,
    RESEND_API_KEY: 'test-resend-key', RESEND_FROM: 'Directory test <mail@test.local>',
    RESEND_API_BASE_URL: `http://127.0.0.1:${resendPort}`,
    ACCOUNT_VERIFY_TTL_SECONDS: '3',
  };
  requireCommand(['run', 'db:migrate']);
  requireCommand(['run', 'db:seed']);
  requireCommand(['run', 'build']);
  await startApp();

  await check('ACC-001', async () => {
    const email = 'verify-owner@example.invalid';
    const before = messages.length;
    const signup = await request('/api/auth/sign-up/email',
      json({ name: 'Verify Owner', email, password }));
    if (!signup.ok) throw new Error(`Public sign-up returned ${signup.status}.`);
    const signupCookie = cookieFrom(signup);
    const signupSession = await request('/api/auth/get-session', { headers: { Cookie: signupCookie } });
    if ((await signupSession.json())?.user) throw new Error('Public sign-up establishes a session before email verification.');
    const denied = await request('/owner/listings', { headers: { Cookie: signupCookie } });
    if (denied.ok) throw new Error('Unverified account reached its private workspace.');
    const link = await mailLink(email, before);
    const verified = await request(link);
    if (verified.status >= 400) throw new Error(`Verification link returned ${verified.status}.`);
    const session = await signIn(email);
    if (!session.response.ok || !session.cookie) throw new Error('Verified owner cannot sign in.');
    const replay = await request(link);
    if (cookieFrom(replay)) throw new Error('Reused verification link created a session.');
    const expiredEmail = 'expired-verify@example.invalid';
    const beforeExpired = messages.length;
    const expiredSignup = await request('/api/auth/sign-up/email',
      json({ name: 'Expired Verify', email: expiredEmail, password }));
    if (!expiredSignup.ok) throw new Error('Second verification fixture failed.');
    const expiredLink = await mailLink(expiredEmail, beforeExpired);
    await new Promise((resolve) => setTimeout(resolve, 4_000));
    await request(expiredLink);
    const expiredVerified = withDb((db) => db.prepare('SELECT emailVerified FROM "user" WHERE email = ?')
      .get(expiredEmail)?.emailVerified);
    if (expiredVerified) throw new Error('Expired verification link verified an account.');
    const admin = await provision('first-admin@example.invalid', 'admin', false);
    if (!admin.cookie) throw new Error('First host-provisioned administrator cannot sign in.');
  });
  await stopApp();
  await startApp();

  await check('ACC-002', async () => {
    const email = 'reset-owner@example.invalid';
    const owner = await provision(email);
    const unknown = await request('/api/auth/request-password-reset',
      json({ email: 'unknown-reset@example.invalid', redirectTo: `${origin}/owner/reset-password` }));
    const before = messages.length;
    const known = await request('/api/auth/request-password-reset',
      json({ email, redirectTo: `${origin}/owner/reset-password` }));
    if (known.status !== unknown.status || (await known.text()) !== (await unknown.text())) {
      throw new Error('Reset request response reveals account existence.');
    }
    const link = await mailLink(email, before);
    const resetPage = await request(link);
    if (resetPage.status !== 302) throw new Error('Reset link did not redirect to the password form.');
    const resetLocation = new URL(resetPage.headers.get('location'), origin);
    const token = resetLocation.searchParams.get('token');
    if (resetLocation.pathname !== '/owner/reset-password' || !token) {
      throw new Error('Reset link has no usable password form or token.');
    }
    const form = await request(resetLocation);
    if (!form.ok) throw new Error('Reset password form is unavailable.');
    const reset = await request('/api/auth/reset-password', json({ token, newPassword: nextPassword }));
    if (!reset.ok) throw new Error('Valid password reset was rejected.');
    const old = await signIn(email);
    const fresh = await signIn(email, nextPassword);
    const oldSession = await request('/owner/listings', { headers: { Cookie: owner.cookie } });
    const replay = await request('/api/auth/reset-password', json({ token, newPassword: password }));
    const beforeExpired = messages.length;
    const again = await request('/api/auth/request-password-reset',
      json({ email, redirectTo: `${origin}/owner/reset-password` }));
    if (!again.ok) throw new Error('Second reset request failed.');
    const expiredLink = await mailLink(email, beforeExpired);
    withDb((db) => db.prepare('UPDATE verification SET expiresAt = ?').run(0));
    const expired = await request('/api/auth/reset-password',
      json({ token: new URL(expiredLink).pathname.split('/').at(-1), newPassword: password }));
    if (old.response.ok || !fresh.response.ok || !fresh.cookie || oldSession.ok || replay.ok || expired.ok) {
      throw new Error('Password reset left old credentials/session usable or accepted token replay.');
    }
  });
  await stopApp();
  await startApp();

  await check('ACC-003', async () => {
    const email = 'magic-owner@example.invalid';
    await provision(email);
    const before = messages.length;
    const send = await request('/api/auth/sign-in/magic-link',
      json({ email, callbackURL: '/owner/listings' }));
    if (!send.ok || cookieFrom(send)) throw new Error('Magic-link request failed or created a session.');
    const link = await mailLink(email, before);
    const invalidLink = new URL(link);
    invalidLink.searchParams.set('token', 'invalid-magic-link-token');
    const invalid = await request(invalidLink);
    if (cookieFrom(invalid)) throw new Error('Invalid magic link established a session.');
    const verified = await request(link);
    if (!cookieFrom(verified)) throw new Error('Valid magic link did not establish a session.');
    const replay = await request(link);
    if (cookieFrom(replay)) throw new Error('Reused magic link established another session.');
    const unknown = 'unknown-magic@example.invalid';
    await request('/api/auth/sign-in/magic-link', json({ email: unknown }));
    const count = withDb((db) => db.prepare('SELECT COUNT(*) AS count FROM "user" WHERE email = ?')
      .get(unknown).count);
    if (count !== 0) throw new Error('Magic link created an unknown account.');
  });
  await stopApp();
  await startApp();

  await check('ACC-004', async () => {
    withDb((db) => db.prepare('UPDATE "user" SET role = ? WHERE email = ?')
      .run('user', 'first-admin@example.invalid'));
    const admin = await provision('suspend-admin@example.invalid', 'admin');
    const owner = await provision('suspend-owner@example.invalid');
    const listing = {
      slug: 'suspension-check', name: 'Suspension Check', summary: 'Account suspension fixture.',
      description: 'An approved resource owned by the account that will be suspended.',
      category: 'Tools', url: 'https://example.org/suspension-check',
    };
    const created = await request('/api/owner/listings', json(listing, owner.cookie));
    if (created.status !== 201) throw new Error(`Owner listing fixture returned ${created.status}.`);
    const submitted = await request('/api/owner/listings/suspension-check/submit', json({}, owner.cookie));
    const submission = (await submitted.json())?.submission;
    if (!submitted.ok || !submission?.id) throw new Error('Owner listing fixture could not be submitted.');
    const approved = await request(`/api/admin/submissions/${submission.id}/decision`,
      json({ decision: 'approve', reason: 'Fixture is valid' }, admin.cookie));
    if (!approved.ok) throw new Error('Owner listing fixture could not be approved.');
    const denied = await request(`/api/admin/accounts/${owner.id}/suspension`,
      json({ suspended: true, reason: 'Fixture' }, owner.cookie, 'PATCH'));
    const suspended = await request(`/api/admin/accounts/${owner.id}/suspension`,
      json({ suspended: true, reason: 'Fixture' }, admin.cookie, 'PATCH'));
    if (denied.ok || !suspended.ok) throw new Error('Account suspension authorization or action failed.');
    const oldSession = await request('/api/owner/listings', { headers: { Cookie: owner.cookie } });
    const newSession = await signIn('suspend-owner@example.invalid');
    const publicPage = await request('/listings/suspension-check');
    const finalAdmin = await request(`/api/admin/accounts/${admin.id}/suspension`,
      json({ suspended: true, reason: 'Fixture' }, admin.cookie, 'PATCH'));
    const audit = withDb((db) => db.prepare(`SELECT actor_user_id FROM audit_events
      WHERE action = 'account.suspend' AND target = ? ORDER BY occurred_at DESC LIMIT 1`).get(owner.id));
    if (oldSession.ok) throw new Error('Suspended account retained an existing session.');
    if (newSession.response.ok) throw new Error('Suspended account signed in again.');
    if (publicPage.ok) throw new Error('Suspended account listing remains public.');
    if (finalAdmin.ok) throw new Error('Final active administrator was suspended.');
    if (audit?.actor_user_id !== admin.id) throw new Error('Suspension lacks actor audit record.');
    const restored = await request(`/api/admin/accounts/${owner.id}/suspension`,
      json({ suspended: false }, admin.cookie, 'PATCH'));
    const restoredPage = await request('/listings/suspension-check');
    if (!restored.ok || !restoredPage.ok) throw new Error('Reinstatement did not restore approved listing.');
    const adminPage = await request('/admin/accounts', { headers: { Cookie: admin.cookie } });
    if (!adminPage.ok || !(await adminPage.text()).includes('Suspend')) {
      throw new Error('Account administration has no suspension control.');
    }
  });
} catch (error) {
  process.stderr.write(`Account mechanism setup: ${error.message}\n`);
} finally {
  await stopApp();
  if (mailServer) await new Promise((resolve) => mailServer.close(resolve));
  rmSync(workspace, { recursive: true, force: true });
  for (const [id, ok] of Object.entries(results)) {
    process.stdout.write(`sudus: ${id}: ${ok ? 'pass' : 'fail'}\n`);
  }
}
