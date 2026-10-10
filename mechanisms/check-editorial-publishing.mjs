import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { startAccountMail } from './account-test-mail.mjs';

const ids = ['EDIT-001', 'EDIT-002', 'EDIT-003'];
const results = Object.fromEntries(ids.map((id) => [id, false]));
const workspace = mkdtempSync(join(tmpdir(), 'directory-editorial-check-'));
let app;
let origin;
let appEnv;
let adminCookie;
let editorCookie;
let memberCookie;
let mail;

function command(args) {
  return spawnSync('npm', args, { env: appEnv, encoding: 'utf8', timeout: 120_000 });
}

function requireCommand(args) {
  const result = command(args);
  if (result.status !== 0) throw new Error(`${args[0]} ${args[1] ?? ''} exited ${result.status}.`);
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
const contains = (content, value) => content.toLowerCase().includes(value.toLowerCase());

function parsedFeed(xml) {
  if (XMLValidator.validate(xml) !== true) throw new Error('The article feed is malformed XML.');
  for (const character of xml) {
    const point = character.codePointAt(0);
    if (!(point === 9 || point === 10 || point === 13 ||
      (point >= 32 && point <= 0xd7ff) ||
      (point >= 0xe000 && point <= 0xfffd) ||
      (point >= 0x10000 && point <= 0x10ffff))) {
      throw new Error('The article feed contains an XML-invalid code point.');
    }
  }
  const parsed = new XMLParser().parse(xml);
  if (!parsed.rss?.channel) throw new Error('The article feed is missing an RSS channel.');
  return Array.isArray(parsed.rss.channel.item)
    ? parsed.rss.channel.item : parsed.rss.channel.item ? [parsed.rss.channel.item] : [];
}

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

async function signIn(email, password) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await request('/api/auth/sign-in/email', json({ email, password }));
    if (response.status === 429) {
      await new Promise((resolve) => setTimeout(resolve, 2_500));
      continue;
    }
    const cookie = cookieFrom(response);
    if (!response.ok || !cookie) throw new Error(`Sign-in failed for ${email}: ${response.status}.`);
    return cookie;
  }
  throw new Error(`Sign-in rate limit persisted for ${email}.`);
}

async function identities() {
  const password = randomBytes(20).toString('hex');
  requireCommand(['run', 'account:provision', '--', '--email', 'editorial-admin@example.invalid',
    '--password', password, '--role', 'admin', '--yes']);
  adminCookie = await signIn('editorial-admin@example.invalid', password);
  const before = mail.count();
  const member = await request('/api/auth/sign-up/email',
    json({ email: 'editorial-member@example.invalid', password, name: 'Member' }));
  if (!member.ok || cookieFrom(member)) throw new Error(`Member sign-up failed or bypassed verification: ${member.status}.`);
  const verified = await request(await mail.link('editorial-member@example.invalid', before));
  if (verified.status >= 400) throw new Error(`Member verification returned ${verified.status}.`);
  memberCookie = await signIn('editorial-member@example.invalid', password);
}

async function ensureEditor() {
  if (editorCookie) return;
  const password = randomBytes(20).toString('hex');
  requireCommand(['run', 'account:provision', '--', '--email', 'editorial-editor@example.invalid',
    '--password', password, '--role', 'editor', '--yes']);
  editorCookie = await signIn('editorial-editor@example.invalid', password);
}

function article(slug, status = 'draft', tags = []) {
  return {
    slug,
    title: `Article ${slug}`,
    summary: `Summary for ${slug}`,
    body: `Body for ${slug}, readable without JavaScript.`,
    status,
    tags,
  };
}

async function createArticle(slug, status = 'draft', tags = []) {
  const response = await request('/api/admin/articles', json(article(slug, status, tags), editorCookie));
  if (response.status !== 201) throw new Error(`Article creation returned ${response.status}.`);
  return response.json();
}

async function updateArticle(slug, changes) {
  const response = await request(`/api/admin/articles/${slug}`, json(changes, editorCookie, 'PATCH'));
  if (!response.ok) throw new Error(`Article update returned ${response.status}.`);
  return response.json();
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
    CI: '1',
    DATABASE_URL: `file:${join(workspace, 'directory.db')}`,
    BETTER_AUTH_SECRET: randomBytes(32).toString('hex'),
    BETTER_AUTH_URL: origin,
    SITE_URL: origin,
  };
  requireCommand(['run', 'db:migrate']);
  requireCommand(['run', 'db:seed']);
  requireCommand(['run', 'build']);
  await startApp();
  await identities();

  await check('EDIT-001', async () => {
    const adminPage = await request('/admin/articles', { headers: { Cookie: adminCookie } });
    if (!adminPage.ok || !contains(await adminPage.text(), 'Articles')) {
      throw new Error('The protected article workspace is missing.');
    }
    await ensureEditor();
    const editorPage = await request('/admin/articles', { headers: { Cookie: editorCookie } });
    const memberPage = await request('/admin/articles', { headers: { Cookie: memberCookie } });
    if (!editorPage.ok || !contains(await editorPage.text(), 'Articles') || memberPage.status === 200) {
      throw new Error('An authorized editor has no article workspace or a member can open it.');
    }
    await createArticle('private-draft');
    const longArticle = await request('/api/admin/articles', json({
      ...article('long-draft'), body: 'x'.repeat(50_000),
    }, editorCookie));
    if (longArticle.status !== 201) {
      throw new Error(`A valid 50,000-character article body was rejected with ${longArticle.status}.`);
    }
    const privateDetail = await request('/articles/private-draft');
    const guestCreate = await request('/api/admin/articles', json(article('guest-article')));
    const memberCreate = await request('/api/admin/articles', json(article('member-article'), memberCookie));
    if (privateDetail.status !== 404 || ![401, 403].includes(guestCreate.status) ||
        ![401, 403].includes(memberCreate.status)) {
      throw new Error('A draft is public or an unauthorized account can create an article.');
    }
    await updateArticle('private-draft', { status: 'published' });
    const published = await request('/articles/private-draft');
    const index = await request('/articles');
    if (!published.ok || !contains(await published.text(), 'Body for private-draft') ||
        !index.ok || !contains(await index.text(), 'Article private-draft')) {
      throw new Error('A published article is absent from its public page or article index.');
    }
    await updateArticle('private-draft', { status: 'draft' });
    if ((await request('/articles/private-draft')).status !== 404) {
      throw new Error('An unpublished article remains publicly reachable.');
    }
  });

  await check('EDIT-002', async () => {
    const ownerCategory = await request('/api/owner/listings', json({
      slug: 'owner-created-category', name: 'Owner-created category',
      summary: 'A private owner draft.', description: 'Should not add a global category.',
      category: 'Owner Only', url: 'https://example.invalid/owner-category',
    }, memberCookie));
    const beforeCategories = await (await request('/listings')).text();
    if (ownerCategory.status !== 400 || contains(beforeCategories, 'Owner Only</option>')) {
      throw new Error('A listing owner can create a global category without operator permission.');
    }
    const memberCategory = await request('/api/admin/categories',
      json({ name: 'Research' }, memberCookie));
    const category = await request('/api/admin/categories',
      json({ name: 'Research' }, adminCookie));
    if (![401, 403].includes(memberCategory.status) || category.status !== 201) {
      throw new Error('Category creation is missing or can be done by an unprivileged member.');
    }
    const taxonomyPage = await request('/admin/taxonomy', { headers: { Cookie: adminCookie } });
    const memberTaxonomy = await request('/admin/taxonomy', { headers: { Cookie: memberCookie } });
    if (!taxonomyPage.ok || !contains(await taxonomyPage.text(), 'Tags') || memberTaxonomy.status === 200) {
      throw new Error('The taxonomy workspace is missing or available to an unprivileged member.');
    }
    const listings = await request('/listings');
    if (!listings.ok || !contains(await listings.text(), 'Research</option>')) {
      throw new Error('An added category is absent from directory navigation.');
    }
    const draftCategory = await request('/api/admin/categories',
      json({ name: 'Draft Only' }, adminCookie));
    const pendingCategory = await request('/api/admin/categories',
      json({ name: 'Pending Only' }, adminCookie));
    const owned = await request('/api/owner/listings', json({
      slug: 'taxonomy-owner', name: 'Taxonomy owner', summary: 'A link under review.',
      description: 'Used to test category references in private owner work.',
      category: 'Research', url: 'https://example.invalid/taxonomy-owner',
    }, memberCookie));
    if (draftCategory.status !== 201 || pendingCategory.status !== 201 || owned.status !== 201) {
      throw new Error(`Could not prepare owner taxonomy proposal: categories ${draftCategory.status}/${pendingCategory.status}, owner ${owned.status}.`);
    }
    const ownerHeaders = { Cookie: memberCookie, Origin: origin };
    const adminHeaders = { Cookie: adminCookie, Origin: origin };
    const firstSubmit = await request('/api/owner/listings/taxonomy-owner/submit',
      { method: 'POST', headers: ownerHeaders });
    if (!firstSubmit.ok) throw new Error('Could not submit the owner listing.');
    const firstId = (await firstSubmit.json()).submission.id;
    const approved = await request(`/api/admin/submissions/${firstId}/decision`,
      json({ decision: 'approve', reason: 'Test approval' }, adminCookie));
    if (!approved.ok) throw new Error('Could not approve the owner listing.');
    const draftEdit = await request('/api/owner/listings/taxonomy-owner',
      json({ category: 'Draft Only' }, memberCookie, 'PATCH'));
    const deleteDraft = await request('/api/admin/categories/Draft%20Only',
      { method: 'DELETE', headers: adminHeaders });
    if (!draftEdit.ok || deleteDraft.status !== 409) {
      throw new Error('A category referenced by an owner draft can be deleted.');
    }
    const pendingEdit = await request('/api/owner/listings/taxonomy-owner',
      json({ category: 'Pending Only' }, memberCookie, 'PATCH'));
    const secondSubmit = await request('/api/owner/listings/taxonomy-owner/submit',
      { method: 'POST', headers: ownerHeaders });
    const deletePending = await request('/api/admin/categories/Pending%20Only',
      { method: 'DELETE', headers: adminHeaders });
    if (!pendingEdit.ok || !secondSubmit.ok || deletePending.status !== 409) {
      throw new Error('A category referenced by a pending owner submission can be deleted.');
    }
    const tag = await request('/api/admin/tags', json({ name: 'Release Notes' }, adminCookie));
    if (tag.status !== 201) throw new Error(`Article tag creation returned ${tag.status}.`);
    await ensureEditor();
    await createArticle('tagged-article', 'published', ['Release Notes']);
    const detail = await request('/articles/tagged-article');
    if (!detail.ok || !contains(await detail.text(), 'Release Notes')) {
      throw new Error('An operator-managed tag is absent from its published article.');
    }
  });

  await check('EDIT-003', async () => {
    const initialFeed = await request('/feed.xml');
    if (!initialFeed.ok || !contains(initialFeed.headers.get('content-type') ?? '', 'xml')) {
      throw new Error('The article feed is missing or is not XML.');
    }
    parsedFeed(await initialFeed.text());
    await ensureEditor();
    await createArticle('feed-published', 'published');
    await createArticle('feed-second', 'published');
    await createArticle('feed-draft');
    const special = await request('/api/admin/articles', json({
      ...article('feed-special', 'published'),
      title: 'A & B < C\ufffe valid',
      summary: 'Summary & <world>\uffff valid',
    }, editorCookie));
    if (special.status !== 201) throw new Error(`Special-character article returned ${special.status}.`);
    const currentFeed = await request('/feed.xml');
    const items = parsedFeed(await currentFeed.text());
    const byTitle = new Map(items.map((item) => [item.title, item]));
    if (!currentFeed.ok || !byTitle.has('Article feed-published') ||
        !byTitle.has('Article feed-second') ||
        byTitle.get('Article feed-published')?.link !== `${origin}/articles/feed-published` ||
        byTitle.has('Article feed-draft') ||
        byTitle.get('A & B < C valid')?.description !== 'Summary & <world> valid') {
      throw new Error('The feed omits a published article or includes a draft.');
    }
    await updateArticle('feed-published', { status: 'draft' });
    const after = new Set(parsedFeed(await (await request('/feed.xml')).text()).map((item) => item.title));
    if (after.has('Article feed-published') || !after.has('Article feed-second')) {
      throw new Error('The feed retains an unpublished article or loses a still-published one.');
    }
  });
} catch (error) {
  process.stderr.write(`Editorial mechanism setup: ${error.message}\n`);
} finally {
  await stopApp();
  if (mail) await mail.close();
  rmSync(workspace, { recursive: true, force: true });
  for (const [id, ok] of Object.entries(results)) {
    process.stdout.write(`sudus: ${id}: ${ok ? 'pass' : 'fail'}\n`);
  }
}
