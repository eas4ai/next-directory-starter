import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const requirements = ['SEO-006', 'SEO-007', 'SEO-008', 'SEO-009', 'SEO-010'];
const results = Object.fromEntries(requirements.map((id) => [id, false]));
const workspace = mkdtempSync(join(tmpdir(), 'directory-seo-check-'));
let app;
let origin;
let env;
let adminCookie;
let editorCookie;
let ownerACookie;
let ownerBCookie;

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function command(args) {
  const result = spawnSync('npm', args, { env, encoding: 'utf8', timeout: 180_000 });
  if (result.status !== 0) throw new Error(`${args.join(' ')} failed: ${result.stderr || result.stdout}`);
}

async function start() {
  app = spawn('npm', ['run', 'start', '--', '-p', new URL(origin).port],
    { env, detached: true, stdio: 'ignore' });
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (app.exitCode !== null) break;
    try { if ((await fetch(origin, { signal: AbortSignal.timeout(1000) })).status < 500) return; }
    catch { /* startup */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Production server did not start');
}

const request = (path, options = {}) => fetch(new URL(path, origin), { redirect: 'manual', ...options });
const json = (body, cookie, method = 'POST') => ({ method, body: JSON.stringify(body),
  headers: { Origin: origin, 'Content-Type': 'application/json',
    ...(cookie ? { Cookie: cookie } : {}) } });

async function check(id, run) {
  try { await run(); results[id] = true; }
  catch (error) { process.stderr.write(`${id}: ${error.message}\n`); }
}

try {
  origin = `http://127.0.0.1:${await freePort()}`;
  env = { ...process.env, CI: '1', DATABASE_URL: `file:${join(workspace, 'directory.db')}`,
    BETTER_AUTH_SECRET: randomBytes(32).toString('hex'),
    BETTER_AUTH_URL: origin, SITE_URL: origin };
  command(['run', 'db:migrate']);
  command(['run', 'db:seed']);
  const password = randomBytes(20).toString('hex');
  command(['run', 'account:provision', '--', '--email', 'seo-admin@example.invalid',
    '--password', password, '--role', 'admin', '--yes']);
  for (const [email, role] of [
    ['seo-editor@example.invalid', 'editor'],
    ['seo-owner-a@example.invalid', 'user'],
    ['seo-owner-b@example.invalid', 'user'],
  ]) {
    command(['run', 'account:provision', '--', '--email', email,
      '--password', password, '--role', role, '--yes']);
  }
  command(['run', 'build']);
  await start();
  async function signIn(email) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await request('/api/auth/sign-in/email', json({ email, password }));
      if (response.status === 429) {
        await new Promise((resolve) => setTimeout(resolve, 2_500));
        continue;
      }
      if (!response.ok) throw new Error(`${email} sign-in returned ${response.status}`);
      const cookie = response.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
      if (!cookie) throw new Error(`${email} sign-in returned no session`);
      return cookie;
    }
    throw new Error(`${email} sign-in remained rate limited`);
  }
  adminCookie = await signIn('seo-admin@example.invalid');
  editorCookie = await signIn('seo-editor@example.invalid');
  ownerACookie = await signIn('seo-owner-a@example.invalid');
  ownerBCookie = await signIn('seo-owner-b@example.invalid');

  await check('SEO-006', async () => {
    const guest = await request('/api/admin/seo/settings');
    if (![401, 403, 404].includes(guest.status)) throw new Error('Guest read protected SEO settings');
    const settings = await request('/api/admin/seo/settings',
      { headers: { Cookie: adminCookie } });
    if (!settings.ok) throw new Error(`Admin SEO settings unavailable: HTTP ${settings.status}`);
    const saved = await request('/api/admin/seo/settings', json({
      titleFormat: '%s | Directory Search', description: 'Current directory search description',
      socialImage: '/social.png', googleVerification: 'google-check-value',
      bingVerification: 'bing-check-value',
    }, adminCookie, 'PATCH'));
    if (!saved.ok) throw new Error(`SEO settings could not be saved: HTTP ${saved.status}`);
    const home = await request('/');
    const html = await home.text();
    if (!html.includes('google-check-value') || !html.includes('bing-check-value')) {
      throw new Error('Saved verification values did not appear in initial HTML');
    }
    const editorSettings = await request('/api/admin/seo/settings',
      json({ titleFormat: '%s | Intruder', description: 'Wrong role' }, editorCookie, 'PATCH'));
    const ownerSettings = await request('/api/admin/seo/settings',
      { headers: { Cookie: ownerACookie } });
    if (![401, 403, 404].includes(editorSettings.status) ||
        ![401, 403, 404].includes(ownerSettings.status)) {
      throw new Error('A non-admin accessed site search settings');
    }
    const created = await request('/api/owner/listings', json({
      slug: 'seo-owned', name: 'SEO Owned', summary: 'Approved owner listing',
      description: 'Owner listing for direct SEO authorization checks.', category: 'Tools',
      url: 'https://example.org/seo-owned',
      seo: { title: 'Approved Owner SEO', description: null, socialImage: null, indexable: null },
    }, ownerACookie));
    if (created.status !== 201) throw new Error(`Owner SEO fixture unavailable: HTTP ${created.status}`);
    const wrongOwner = await request('/api/owner/listings/seo-owned', json({
      seo: { title: 'Hijacked SEO', description: null, socialImage: null, indexable: false },
    }, ownerBCookie, 'PATCH'));
    const wrongEditor = await request('/api/owner/listings/seo-owned', json({
      seo: { title: 'Editor hijack', description: null, socialImage: null, indexable: false },
    }, editorCookie, 'PATCH'));
    if (![401, 403, 404].includes(wrongOwner.status) ||
        ![401, 403, 404].includes(wrongEditor.status)) {
      throw new Error('A different owner or editor changed listing search overrides');
    }
    const submitted = await request('/api/owner/listings/seo-owned/submit', json({}, ownerACookie));
    if (!submitted.ok) throw new Error('Owner SEO listing could not be submitted');
    const submissionId = (await submitted.json()).submission?.id;
    const approved = await request(`/api/admin/submissions/${submissionId}/decision`,
      json({ decision: 'approve', reason: 'SEO release check' }, adminCookie));
    if (!approved.ok || !(await (await request('/listings/seo-owned')).text())
      .includes('Approved Owner SEO')) {
      throw new Error('Approved owner search override did not become public');
    }
    const article = await request('/api/admin/articles', json({
      slug: 'staged-seo-article', title: 'Staged SEO article', summary: 'Public article summary',
      body: 'Public article body', status: 'published', category: '', tags: [],
      seo: { title: 'Approved Article SEO', description: null, socialImage: null, indexable: null },
    }, adminCookie));
    if (article.status !== 201) throw new Error('Staged article fixture could not be created');
    const version = (await article.json()).article.version;
    const wrongArticleEditor = await request('/api/admin/articles/staged-seo-article',
      json({ action: 'save', version, seo: { title: 'Owner hijack', indexable: false } },
        ownerACookie, 'PATCH'));
    if (![401, 403, 404].includes(wrongArticleEditor.status)) {
      throw new Error('An owner changed article search overrides');
    }
    const staged = await request('/api/admin/articles/staged-seo-article',
      json({ action: 'save', version,
        seo: { title: 'Unpublished Article SEO', description: null,
          socialImage: null, indexable: false } }, editorCookie, 'PATCH'));
    if (!staged.ok) throw new Error(`Editor could not stage article SEO: HTTP ${staged.status}`);
    const beforePublish = await (await request('/articles/staged-seo-article')).text();
    if (!beforePublish.includes('Approved Article SEO') ||
        beforePublish.includes('Unpublished Article SEO') || beforePublish.includes('content="noindex')) {
      throw new Error('Staged article SEO leaked into initial public HTML');
    }
    const stagedVersion = (await staged.json()).article.version;
    const published = await request('/api/admin/articles/staged-seo-article',
      json({ action: 'publish', version: stagedVersion }, editorCookie, 'PATCH'));
    const afterPublish = await (await request('/articles/staged-seo-article')).text();
    if (!published.ok || !afterPublish.includes('Unpublished Article SEO') ||
        !afterPublish.includes('content="noindex')) {
      throw new Error('Published article SEO did not replace the staged values');
    }
  });

  await check('SEO-007', async () => {
    const listing = await request('/listings/example-tool',
      { headers: { Host: 'attacker.invalid' } });
    const html = await listing.text();
    if (!listing.ok || !html.includes(`${origin}/listings/example-tool`)) {
      throw new Error('Public listing metadata did not use the configured origin');
    }
    const changed = await request('/api/admin/seo/settings', json({
      titleFormat: '%s | Directory Search', description: 'Current directory search description',
      socialImage: '/social.png', googleVerification: 'google-check-value',
      bingVerification: 'bing-check-value',
    }, adminCookie, 'PATCH'));
    if (!changed.ok) throw new Error(`Configured social default unavailable: HTTP ${changed.status}`);
    const updatedHtml = await (await request('/listings/example-tool')).text();
    if (!updatedHtml.includes('og:image') || !updatedHtml.includes('social.png')) {
      throw new Error('Public social metadata omitted the configured image');
    }
    const noindex = await request('/api/admin/articles', json({
      slug: 'noindex-seo-article', title: 'Noindex SEO article', summary: 'Visible, but not indexed',
      body: 'A published article excluded from search indexing.', status: 'published',
      category: '', tags: [], seo: { title: null, description: null,
        socialImage: null, indexable: false },
    }, adminCookie));
    if (noindex.status !== 201) throw new Error(`Noindex fixture unavailable: HTTP ${noindex.status}`);
    const noindexHtml = await (await request('/articles/noindex-seo-article')).text();
    const sitemap = await (await request('/sitemap.xml')).text();
    if (!noindexHtml.includes('content="noindex') ||
        sitemap.includes(`${origin}/articles/noindex-seo-article`) ||
        !sitemap.includes(`${origin}/listings/example-tool`)) {
      throw new Error('Published noindex page metadata and sitemap eligibility disagree');
    }
    const stagedListing = await request('/api/owner/listings/seo-owned', json({
      seo: { title: 'Noindex Owner SEO', description: null, socialImage: null, indexable: false },
    }, ownerACookie, 'PATCH'));
    if (!stagedListing.ok) throw new Error('Owner could not stage a noindex listing revision');
    const beforeApprovalHtml = await (await request('/listings/seo-owned')).text();
    const beforeApprovalSitemap = await (await request('/sitemap.xml')).text();
    if (beforeApprovalHtml.includes('Noindex Owner SEO') ||
        beforeApprovalHtml.includes('content="noindex') ||
        !beforeApprovalSitemap.includes(`${origin}/listings/seo-owned`)) {
      throw new Error('Staged noindex listing changed public crawl state before approval');
    }
    const submitted = await request('/api/owner/listings/seo-owned/submit', json({}, ownerACookie));
    if (!submitted.ok) throw new Error('Noindex listing revision could not be submitted');
    const submissionId = (await submitted.json()).submission?.id;
    const approved = await request(`/api/admin/submissions/${submissionId}/decision`,
      json({ decision: 'approve', reason: 'Noindex release check' }, adminCookie));
    const afterApprovalHtml = await (await request('/listings/seo-owned')).text();
    const afterApprovalSitemap = await (await request('/sitemap.xml')).text();
    if (!approved.ok || !afterApprovalHtml.includes('Noindex Owner SEO') ||
        !afterApprovalHtml.includes('content="noindex') ||
        afterApprovalSitemap.includes(`${origin}/listings/seo-owned`)) {
      throw new Error('Approved noindex listing metadata and sitemap eligibility disagree');
    }
  });

  await check('SEO-008', async () => {
    const external = await request('/api/admin/seo/redirects',
      json({ source: '/old-tool', destination: 'https://outside.invalid/' }, adminCookie));
    if (external.status < 400 || external.status >= 500) {
      throw new Error(`Unsafe external redirect was accepted: HTTP ${external.status}`);
    }
    const saved = await request('/api/admin/seo/redirects',
      json({ source: '/old-tool', destination: '/listings/example-tool' }, adminCookie));
    if (!saved.ok) throw new Error(`Same-site redirect was not saved: HTTP ${saved.status}`);
    for (const source of ['/listings/future-seo-listing', '/listings/future-owner-seo',
      '/articles/future-seo-article', '/articles/future-rename-seo']) {
      const reserved = await request('/api/admin/seo/redirects',
        json({ source, destination: '/articles' }, adminCookie));
      if (!reserved.ok) throw new Error(`Future path redirect could not be reserved: ${source}`);
    }
    const adminListing = await request('/api/admin/listings', json({
      slug: 'future-seo-listing', name: 'Future SEO listing', summary: 'Future listing',
      description: 'Should not shadow the saved redirect', category: 'Tools',
      url: 'https://example.org/future-seo-listing', status: 'published',
    }, adminCookie));
    const ownerListing = await request('/api/owner/listings', json({
      slug: 'future-owner-seo', name: 'Future owner SEO', summary: 'Future owner listing',
      description: 'Should not shadow the saved redirect', category: 'Tools',
      url: 'https://example.org/future-owner-seo',
    }, ownerACookie));
    const articleCollision = await request('/api/admin/articles', json({
      slug: 'future-seo-article', title: 'Future SEO article', summary: 'Future article',
      body: 'Should not shadow the saved redirect', status: 'published', category: '', tags: [],
    }, adminCookie));
    if (adminListing.status !== 409 || ownerListing.status !== 409 ||
        articleCollision.status !== 409) {
      throw new Error(`Content claimed a reserved redirect source: ${adminListing.status}/${ownerListing.status}/${articleCollision.status}`);
    }
    const shadow = await request('/api/admin/seo/redirects',
      json({ source: '/listings/example-tool', destination: '/articles' }, adminCookie));
    if (shadow.status < 400 || shadow.status >= 500) throw new Error('A live listing route was shadowed');
    const firstCycle = await request('/api/admin/seo/redirects',
      json({ source: '/cycle-one', destination: '/cycle-two' }, adminCookie));
    const secondCycle = await request('/api/admin/seo/redirects',
      json({ source: '/cycle-two', destination: '/cycle-one' }, adminCookie));
    if (!firstCycle.ok || secondCycle.status < 400 || secondCycle.status >= 500) {
      throw new Error('Redirect cycles were not rejected');
    }
    const alias = await request('/old-tool?token=private-value');
    const destination = alias.headers.get('location');
    if (alias.status !== 301 || !destination ||
        new URL(destination, origin).toString() !== `${origin}/listings/example-tool` ||
        destination.includes('private-value')) {
      throw new Error(`Redirect did not return a clean permanent destination: HTTP ${alias.status}`);
    }
    const missing = await request('/missing-seo-page?token=private-value');
    if (missing.status !== 404) throw new Error(`Missing page returned HTTP ${missing.status}`);
    const report = await request('/api/admin/seo/not-found', { headers: { Cookie: adminCookie } });
    const reportText = await report.text();
    if (!report.ok || !reportText.includes('/missing-seo-page') || reportText.includes('private-value')) {
      throw new Error('404 report was unavailable or retained query credentials');
    }
    const rows = JSON.parse(reportText).paths;
    if (rows.find((row) => row.path === '/missing-seo-page')?.hits !== 1) {
      throw new Error('One missing request was counted more than once');
    }
    const created = await request('/api/admin/articles', json({ slug: 'old-seo-article',
      title: 'Old SEO article', summary: 'Summary', body: 'Body', status: 'published',
      category: '', tags: [] }, adminCookie));
    if (created.status !== 201) throw new Error(`Article for slug redirect unavailable: HTTP ${created.status}`);
    const version = (await created.json()).article.version;
    const reservedRename = await request('/api/admin/articles/old-seo-article',
      json({ action: 'rename', newSlug: 'future-rename-seo', version }, adminCookie, 'PATCH'));
    if (reservedRename.status !== 409) throw new Error('Article rename claimed a reserved redirect source');
    const renamed = await request('/api/admin/articles/old-seo-article',
      json({ action: 'rename', newSlug: 'new-seo-article', version }, adminCookie, 'PATCH'));
    if (!renamed.ok || (await request('/articles/new-seo-article')).status !== 200) {
      throw new Error('Published article slug change did not retain the new article');
    }
    const oldArticle = await request('/articles/old-seo-article?token=private-value');
    if (oldArticle.status !== 301 ||
        new URL(oldArticle.headers.get('location') || '/', origin).toString() !==
          `${origin}/articles/new-seo-article` ||
        oldArticle.headers.get('location')?.includes('private-value')) {
      throw new Error('Old published article slug did not redirect cleanly');
    }
  });

  await check('SEO-009', async () => {
    const local = spawnSync('node', ['--import', 'tsx', '--test', 'tests/seo-findings.test.mjs'],
      { env, encoding: 'utf8', timeout: 30_000 });
    if (local.status !== 0) throw new Error(`SEO findings state check failed: ${local.stderr || local.stdout}`);
    const guest = await request('/api/admin/seo/findings');
    if (![401, 403, 404].includes(guest.status)) throw new Error('Guest read SEO findings');
    const findings = await request('/api/admin/seo/findings',
      { headers: { Cookie: adminCookie } });
    if (!findings.ok) throw new Error(`SEO findings unavailable: HTTP ${findings.status}`);
    const value = await findings.json();
    if (!Array.isArray(value.findings) || !value.preview) {
      throw new Error('SEO findings lacked actionable rows or a public preview');
    }
    const second = await request('/api/admin/listings', json({ slug: 'second-example',
      name: 'Example Tool', summary: 'Another public sample listing with the same title',
      description: 'A separate public listing for search findings.', category: 'Tools',
      url: 'https://example.org/second', status: 'published' }, adminCookie));
    if (second.status !== 201) throw new Error(`Duplicate fixture unavailable: HTTP ${second.status}`);
    const updated = await request('/api/admin/seo/findings', { headers: { Cookie: adminCookie } });
    const duplicateRows = (await updated.json()).findings.filter((item) => item.code === 'duplicate-title');
    if (!duplicateRows.some((item) => item.path === '/listings/example-tool') ||
        !duplicateRows.some((item) => item.path === '/listings/second-example')) {
      throw new Error('Duplicate public titles were not actionable findings');
    }
    const previewResponse = await request('/api/admin/seo/findings?kind=listing&slug=example-tool',
      { headers: { Cookie: adminCookie } });
    if (!previewResponse.ok) throw new Error('Published listing preview unavailable');
    const selected = (await previewResponse.json()).preview;
    const html = await (await request('/listings/example-tool')).text();
    const metas = [...html.matchAll(/<meta\b[^>]*>/g)].map(([tag]) =>
      Object.fromEntries([...tag.matchAll(/([\w:-]+)="([^"]*)"/g)].map(([, key, content]) => [key, content])));
    const ogTitle = metas.find((attrs) => attrs.property === 'og:title')?.content;
    const ogImage = metas.find((attrs) => attrs.property === 'og:image')?.content;
    if (selected.search.canonical !== `${origin}/listings/example-tool` ||
        selected.social.title !== ogTitle || selected.social.image !== ogImage) {
      throw new Error('Search/social preview differed from initial public HTML');
    }
    const draft = await request('/api/admin/articles', json({ slug: 'private-seo-draft',
      title: 'Private SEO draft', summary: 'Hidden summary', body: 'Hidden body',
      status: 'draft', category: '', tags: [] }, adminCookie));
    if (draft.status !== 201) throw new Error('Private preview fixture unavailable');
    const privatePreview = await request('/api/admin/seo/findings?kind=article&slug=private-seo-draft',
      { headers: { Cookie: adminCookie } });
    if (privatePreview.status !== 404) throw new Error('Private draft received a public SEO preview');
  });

  await check('SEO-010', async () => {
    const response = await request('/markdown/listings/example-tool');
    const body = await response.text();
    if (!response.ok || !response.headers.get('content-type')?.includes('text/markdown') ||
        !response.headers.get('x-robots-tag')?.includes('noindex') ||
        !response.headers.get('cache-control')?.includes('no-store') ||
        response.headers.get('x-content-type-options') !== 'nosniff' ||
        !body.includes('Example Tool')) {
      throw new Error(`Eligible Markdown twin missing or invalid: HTTP ${response.status}`);
    }
    if ((await request('/markdown/listings/hidden-draft')).status !== 404) {
      throw new Error('Draft Markdown twin was publicly reachable');
    }
    const html = await (await request('/listings/example-tool')).text();
    if (!html.includes('text/markdown') || !html.includes('/markdown/listings/example-tool')) {
      throw new Error('Public HTML did not advertise its Markdown twin');
    }
    const article = await request('/markdown/articles/new-seo-article');
    const articleBody = await article.text();
    const articleHtml = await (await request('/articles/new-seo-article')).text();
    if (!article.ok || !article.headers.get('content-type')?.includes('text/markdown') ||
        !article.headers.get('x-robots-tag')?.includes('noindex') ||
        !article.headers.get('cache-control')?.includes('no-store') ||
        !articleBody.includes('Old SEO article') || !articleBody.includes('Body') ||
        !articleHtml.includes('/markdown/articles/new-seo-article')) {
      throw new Error('Published article Markdown twin did not match its HTML source');
    }
    const current = await request('/api/admin/articles/new-seo-article',
      { headers: { Cookie: adminCookie } });
    const version = (await current.json()).article.version;
    const saved = await request('/api/admin/articles/new-seo-article',
      json({ action: 'save', version, body: 'PRIVATE NEXT BODY' }, adminCookie, 'PATCH'));
    if (!saved.ok) throw new Error('Article revision fixture could not be saved');
    const stagedVersion = (await saved.json()).article.version;
    const beforePublish = await (await request('/markdown/articles/new-seo-article')).text();
    if (beforePublish.includes('PRIVATE NEXT BODY') || !beforePublish.includes('Body')) {
      throw new Error('Private article revision leaked into public Markdown');
    }
    const published = await request('/api/admin/articles/new-seo-article',
      json({ action: 'publish', version: stagedVersion }, adminCookie, 'PATCH'));
    if (!published.ok || !(await (await request('/markdown/articles/new-seo-article')).text())
      .includes('PRIVATE NEXT BODY')) {
      throw new Error('Markdown did not switch to the published article revision');
    }
    const unpublished = await request('/api/admin/articles/new-seo-article',
      json({ status: 'draft' }, adminCookie, 'PATCH'));
    if (!unpublished.ok || (await request('/markdown/articles/new-seo-article')).status !== 404) {
      throw new Error('Unpublished article retained its Markdown twin');
    }
    const suspended = await request('/api/admin/listings/example-tool/suspend',
      json({ reason: 'SEO visibility check' }, adminCookie));
    if (!suspended.ok || (await request('/markdown/listings/example-tool')).status !== 404) {
      throw new Error('Suspended listing retained its Markdown twin');
    }
  });
} catch (error) {
  process.stderr.write(`SEO setup: ${error.message}\n`);
} finally {
  if (app) { try { process.kill(-app.pid, 'SIGTERM'); } catch { /* stopped */ } }
  await new Promise((resolve) => setTimeout(resolve, 250));
  rmSync(workspace, { recursive: true, force: true });
  for (const id of requirements) {
    process.stdout.write(`sudus: ${id}: ${results[id] ? 'pass' : 'fail'}\n`);
  }
}
