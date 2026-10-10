import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import Database from 'better-sqlite3';

const workspace = mkdtempSync(join(tmpdir(), 'directory-content-http-'));
let app;

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

const port = await freePort();
const origin = `http://127.0.0.1:${port}`;
const password = randomBytes(20).toString('hex');
const env = { ...process.env, CI: '1', DATABASE_URL: `file:${join(workspace, 'directory.db')}`,
  MEDIA_DIR: join(workspace, 'media'), BETTER_AUTH_SECRET: randomBytes(32).toString('hex'),
  BETTER_AUTH_URL: origin, SITE_URL: origin };

function command(args) {
  const result = spawnSync('npm', args, { env, encoding: 'utf8', timeout: 180_000 });
  assert.equal(result.status, 0, `${args.join(' ')} failed: ${result.stderr || result.stdout}`);
}

const request = (path, options = {}) => fetch(new URL(path, origin), { redirect: 'manual', ...options });
const cookie = (response) => response.headers.getSetCookie()
  .map((value) => value.split(';')[0]).join('; ');
async function expectStatus(response, status) {
  if (response.status !== status) throw new Error(`Expected HTTP ${status}, got ${response.status}: ${await response.text()}`);
}
const json = (body, session, method = 'POST') => ({ method, body: JSON.stringify(body),
  headers: { 'Content-Type': 'application/json', Origin: origin,
    ...(session ? { Cookie: session } : {}) } });

async function login(email) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await request('/api/auth/sign-in/email', json({ email, password }));
    if (response.status === 429) {
      await new Promise((resolve) => setTimeout(resolve, 2_500));
      continue;
    }
    assert.equal(response.status, 200, `Sign-in failed for ${email}: ${response.status}`);
    const session = cookie(response);
    assert.ok(session);
    return session;
  }
  throw new Error(`Sign-in rate limit persisted for ${email}`);
}

async function upload(slug, session, image, options = {}) {
  return request(`/api/owner/listings/${slug}/media`, { method: 'POST', body: image,
    headers: { Origin: origin, Cookie: session, 'Content-Type': 'image/png',
      'X-Image-Alt': 'HTTP upload', ...options } });
}

try {
  command(['run', 'db:migrate']);
  command(['run', 'db:seed']);
  for (const [email, role] of [
    ['http-owner@example.invalid', 'user'], ['http-editor@example.invalid', 'editor'],
    ['http-moderator@example.invalid', 'moderator'], ['http-admin@example.invalid', 'admin'],
  ]) command(['run', 'account:provision', '--', '--email', email, '--password', password,
    '--role', role, '--yes']);
  const database = new Database(join(workspace, 'directory.db'));
  const ownerId = database.prepare('SELECT id FROM "user" WHERE email = ?')
    .get('http-owner@example.invalid').id;
  const failedNotice = database.prepare(`INSERT INTO owner_notifications
    (id, owner_user_id, kind, source_key, subject, body, created_at,
     email_state, email_attempts, email_last_error)
    VALUES (?, ?, 'qa', ?, ?, 'Retained failure', ?, 'failed', 5, 'Resend delivery failed')`);
  for (let index = 0; index < 101; index += 1) {
    const id = `qa-failed-${index}`;
    failedNotice.run(id, ownerId, id, `Failed notice ${index}`,
      new Date(Date.UTC(2025, 0, 1, 0, 0, index)).toISOString());
  }
  database.close();
  command(['run', 'build']);
  app = spawn('npm', ['run', 'start', '--', '-p', String(port)],
    { env, detached: true, stdio: 'ignore' });
  let ready = false;
  for (let i = 0; i < 60; i += 1) {
    try { if ((await request('/')).status < 500) { ready = true; break; } }
    catch { /* startup */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.ok(ready, 'Production server did not start');
  const owner = await login('http-owner@example.invalid');
  const editor = await login('http-editor@example.invalid');
  const moderator = await login('http-moderator@example.invalid');
  const admin = await login('http-admin@example.invalid');
  const deliveryPage = await request('/admin/notifications?page=2', { headers: { Cookie: admin } });
  await expectStatus(deliveryPage, 200);
  const deliveryHtml = await deliveryPage.text();
  assert.ok(deliveryHtml.includes('Failed notice 0'), 'Oldest exhausted notice is missing from page two');
  assert.ok(deliveryHtml.includes('aria-label="Delivery pages"'));
  assert.ok(deliveryHtml.includes('Retry delivery'));
  await expectStatus(await request('/admin/taxonomy', { headers: { Cookie: editor } }), 200);
  await expectStatus(await request('/api/admin/article-categories', { headers: { Cookie: editor } }), 200);
  await expectStatus(await request('/api/admin/article-categories',
    json({ name: 'Editor Topic' }, editor)), 201);
  assert.equal((await request('/api/admin/categories',
    json({ name: 'Editor Cannot Change Listings' }, editor))).status, 403);

  const created = await request('/api/owner/listings', json({ slug: 'http-media',
    name: 'HTTP Media', summary: 'A checked listing', description: 'HTTP media test',
    category: 'Tools', url: 'https://example.org/http-media' }, owner));
  await expectStatus(created, 201);
  const image = await sharp({ create: { width: 12, height: 8, channels: 3,
    background: '#ff8800' } }).png().toBuffer();
  assert.equal((await request('/api/owner/listings/http-media/media',
    { method: 'POST', body: image, headers: { Origin: origin,
      'Content-Type': 'image/png', 'X-Image-Alt': 'Guest' } })).status, 401);
  assert.equal((await upload('http-media', owner, image, { Origin: 'https://forged.invalid' })).status, 403);
  assert.equal((await upload('http-media', owner, Buffer.alloc(5 * 1024 * 1024 + 1))).status, 413);
  const uploaded = await upload('http-media', owner, image);
  await expectStatus(uploaded, 201);
  const first = (await uploaded.json()).asset.id;
  assert.equal((await request(`/api/media/${first}`)).status, 404);
  assert.equal((await request(`/api/media/${first}`, { headers: { Cookie: editor } })).status, 404);
  assert.equal((await request(`/api/media/${first}`, { headers: { Cookie: moderator } })).status, 404);
  assert.equal((await request(`/api/media/${first}`, { headers: { Cookie: owner } })).status, 200);
  assert.equal((await request(`/media/${first}`)).status, 404);

  const submission = await request('/api/owner/listings/http-media/submit', json({}, owner));
  await expectStatus(submission, 200);
  const submissionId = (await submission.json()).submission.id;
  assert.equal((await request(`/api/media/${first}`, { headers: { Cookie: moderator } })).status, 200);
  const approved = await request(`/api/admin/submissions/${submissionId}/decision`,
    json({ decision: 'approve', reason: 'Good' }, moderator));
  await expectStatus(approved, 200);
  assert.equal((await request(`/media/${first}`)).status, 200);
  assert.equal((await request(`/api/media/${first}`, { headers: { Cookie: moderator } })).status, 404);
  const revised = await upload('http-media', owner, image);
  await expectStatus(revised, 201);
  const second = (await revised.json()).asset.id;
  assert.equal((await request(`/media/${first}`)).status, 200);
  assert.equal((await request(`/media/${second}`)).status, 404);

  const published = await request('/api/admin/articles', json({ slug: 'http-article',
    title: 'HTTP Original', summary: 'Original summary', body: 'Original **body**',
    status: 'published', category: '', tags: [] }, editor));
  await expectStatus(published, 201);
  const article = (await published.json()).article;
  const staged = await request('/api/admin/articles/http-article', json({ action: 'save',
    version: article.version, title: 'HTTP Revised', summary: 'Revised summary',
    body: 'Private **revision**', category: '', tags: [] }, editor, 'PATCH'));
  await expectStatus(staged, 200);
  const publicPage = await request('/articles/http-article');
  assert.equal(publicPage.status, 200);
  const publicHtml = await publicPage.text();
  assert.match(publicHtml, /HTTP Original/);
  assert.doesNotMatch(publicHtml, /Private <strong>revision<\/strong>|HTTP Revised/);
  assert.ok([403, 404].includes((await request('/admin/articles/http-article/preview')).status));
  const preview = await request('/admin/articles/http-article/preview',
    { headers: { Cookie: editor } });
  assert.equal(preview.status, 200);
  assert.match(await preview.text(), /HTTP Revised/);
  const filtered = await request('/articles?q=Original');
  assert.equal(filtered.status, 200);
  assert.match(await filtered.text(), /HTTP Original/);
  const hidden = await request('/articles?q=Revised');
  assert.equal(hidden.status, 200);
  assert.doesNotMatch(await hidden.text(), /HTTP Revised/);
  process.stdout.write('Content HTTP routes: pass\n');
} finally {
  if (app) { try { process.kill(-app.pid, 'SIGTERM'); } catch { /* stopped */ } }
  rmSync(workspace, { recursive: true, force: true });
}
