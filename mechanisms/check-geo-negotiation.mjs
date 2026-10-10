import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const workspace = mkdtempSync(join(tmpdir(), 'directory-geo-check-'));
let app;
let passed = false;

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

try {
  const origin = `http://127.0.0.1:${await freePort()}`;
  const env = { ...process.env, CI: '1', DATABASE_URL: `file:${join(workspace, 'directory.db')}`,
    BETTER_AUTH_SECRET: randomBytes(32).toString('hex'), BETTER_AUTH_URL: origin, SITE_URL: origin };
  function command(args) {
    const result = spawnSync('npm', args, { env, encoding: 'utf8', timeout: 180_000 });
    expect(result.status === 0, `${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }
  const request = (path, headers = {}, options = {}) => fetch(new URL(path, origin),
    { redirect: 'manual', headers, ...options });
  const json = (body, cookie, method = 'POST') => ({ method, body: JSON.stringify(body),
    headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: cookie } });
  const write = (path, body, cookie, method = 'POST') => {
    const options = json(body, cookie, method);
    return request(path, options.headers, options);
  };
  async function representation(path, headers = {}) {
    const response = await request(path, headers);
    return { response, body: await response.text() };
  }
  function hasVary(response) {
    const vary = (response.headers.get('vary') ?? '').toLowerCase().split(',').map((part) => part.trim());
    return vary.includes('accept') && vary.includes('user-agent');
  }
  function isMarkdown(response) {
    return response.headers.get('content-type')?.toLowerCase().startsWith('text/markdown');
  }
  function assertMarkdown(result, expected, label) {
    const { response, body } = result;
    expect(response.status === 200 && isMarkdown(response), `${label} did not serve Markdown (HTTP ${response.status})`);
    expect(body === expected, `${label} differed from the current public Markdown twin`);
    expect(response.headers.get('x-robots-tag')?.includes('noindex'), `${label} was indexable`);
    expect(response.headers.get('cache-control')?.includes('no-store'), `${label} was cacheable`);
    expect(response.headers.get('x-content-type-options') === 'nosniff', `${label} lacked nosniff`);
    expect(hasVary(response), `${label} lacked Vary: Accept, User-Agent`);
  }
  function assertHtml(result, label) {
    expect(result.response.status === 200 &&
      result.response.headers.get('content-type')?.includes('text/html'), `${label} was not HTML`);
    expect(result.response.headers.get('cache-control')?.includes('no-store'),
      `${label} was cacheable`);
  }

  command(['run', 'db:migrate']);
  command(['run', 'db:seed']);
  const password = randomBytes(20).toString('hex');
  command(['run', 'account:provision', '--', '--email', 'geo-admin@example.invalid',
    '--password', password, '--role', 'admin', '--yes']);
  rmSync('.next', { recursive: true, force: true });
  command(['run', 'build']);
  app = spawn('npm', ['run', 'start', '--', '-p', new URL(origin).port],
    { env, detached: true, stdio: 'ignore' });
  let started = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (app.exitCode !== null) break;
    try { if ((await request('/')).status < 500) { started = true; break; } }
    catch { /* startup */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  expect(started, 'Production server did not start');

  const signIn = await request('/api/auth/sign-in/email',
    { Origin: origin, 'Content-Type': 'application/json' },
    { method: 'POST', body: JSON.stringify({ email: 'geo-admin@example.invalid', password }) });
  expect(signIn.ok, `Admin sign-in failed: HTTP ${signIn.status}`);
  const cookie = signIn.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
  expect(cookie, 'Admin sign-in returned no session');

  const articleCreated = await write('/api/admin/articles', {
    slug: 'geo-article', title: 'Geo Article', summary: 'Public geo summary',
    body: 'PUBLIC GEO BODY', status: 'published', category: '', tags: [],
  }, cookie);
  expect(articleCreated.status === 201, `Article fixture failed: HTTP ${articleCreated.status}`);
  const version = (await articleCreated.json()).article.version;
  const listingTwin = await representation('/markdown/listings/example-tool');
  const articleTwin = await representation('/markdown/articles/geo-article');
  expect(listingTwin.response.status === 200 && isMarkdown(listingTwin.response), 'Listing twin unavailable');
  expect(articleTwin.response.status === 200 && isMarkdown(articleTwin.response), 'Article twin unavailable');

  for (const [kind, slug, twin] of [
    ['listings', 'example-tool', listingTwin.body], ['articles', 'geo-article', articleTwin.body],
  ]) {
    const path = `/${kind}/${slug}`;
    assertHtml(await representation(path, { Accept: 'text/html' }), `${kind} ordinary request`);
    assertHtml(await representation(path, { Accept: 'text/markdown;q=0',
      'User-Agent': 'ClaudeBot/1.0' }), `${kind} explicit Markdown refusal`);
    assertMarkdown(await representation(path, { Accept: 'text/markdown' }), twin,
      `${kind} Accept negotiation`);
    assertMarkdown(await representation(path, { 'User-Agent': 'ClaudeBot/1.0' }), twin,
      `${kind} user-agent negotiation`);
    assertMarkdown(await representation(`${path}.md`, { Accept: 'text/markdown;q=0' }), twin,
      `${kind} suffix negotiation`);
  }

  for (const path of ['/', '/listings', '/articles', '/admin', '/api/admin/seo/settings']) {
    const result = await representation(path, { Accept: 'text/markdown', 'User-Agent': 'ClaudeBot/1.0' });
    expect(!isMarkdown(result.response), `${path} was converted to Markdown`);
  }
  for (const path of ['/listings/hidden-draft', '/listings/hidden-draft.md',
    '/articles/missing', '/articles/missing.md']) {
    expect((await request(path, { Accept: 'text/markdown' })).status === 404,
      `${path} exposed ineligible content`);
  }

  const saved = await write('/api/admin/articles/geo-article',
    { action: 'save', version, body: 'PRIVATE GEO BODY' }, cookie, 'PATCH');
  expect(saved.ok, `Private revision fixture failed: HTTP ${saved.status}`);
  assertMarkdown(await representation('/articles/geo-article', { Accept: 'text/markdown' }),
    articleTwin.body, 'Article before publication');
  const published = await write('/api/admin/articles/geo-article',
    { action: 'publish', version: (await saved.json()).article.version }, cookie, 'PATCH');
  expect(published.ok, `Article publication failed: HTTP ${published.status}`);
  const currentArticle = await representation('/markdown/articles/geo-article');
  expect(currentArticle.body.includes('PRIVATE GEO BODY'), 'Publication did not change the current article');
  assertMarkdown(await representation('/articles/geo-article.md'), currentArticle.body,
    'Article after publication');
  const unpublished = await write('/api/admin/articles/geo-article',
    { status: 'draft' }, cookie, 'PATCH');
  expect(unpublished.ok, `Article unpublication failed: HTTP ${unpublished.status}`);
  expect((await request('/articles/geo-article', { Accept: 'text/markdown' })).status === 404 &&
    (await request('/articles/geo-article.md')).status === 404,
    'Unpublished article remained available through negotiation');
  const suspended = await write('/api/admin/listings/example-tool/suspend',
    { reason: 'Geo eligibility check' }, cookie);
  expect(suspended.ok, `Listing suspension failed: HTTP ${suspended.status}`);
  expect((await request('/listings/example-tool', { Accept: 'text/markdown' })).status === 404 &&
    (await request('/listings/example-tool.md')).status === 404,
    'Suspended listing remained available through negotiation');
  expect((await request('/markdown/listings/example-tool')).status === 404 &&
    (await request('/markdown/articles/geo-article')).status === 404,
    'Explicit Markdown routes changed eligibility');
  passed = true;
} catch (error) {
  process.stderr.write(`SEO-011: ${error.message}\n`);
} finally {
  if (app) { try { process.kill(-app.pid, 'SIGTERM'); } catch { /* stopped */ } }
  await new Promise((resolve) => setTimeout(resolve, 250));
  rmSync(workspace, { recursive: true, force: true });
  process.stdout.write(`sudus: SEO-011: ${passed ? 'pass' : 'fail'}\n`);
}
