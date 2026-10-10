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
  command(['run', 'build']);
  await start();
  const signedIn = await request('/api/auth/sign-in/email',
    json({ email: 'seo-admin@example.invalid', password }));
  if (!signedIn.ok) throw new Error(`Admin sign-in returned ${signedIn.status}`);
  adminCookie = signedIn.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
  if (!adminCookie) throw new Error('Admin sign-in returned no session');

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
