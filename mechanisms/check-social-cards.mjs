import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';

const workspace = mkdtempSync(join(tmpdir(), 'directory-social-check-'));
let app;
let spy;
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

function meta(html, attribute, value) {
  const tags = [...html.matchAll(/<meta\b[^>]*>/gi)].map(([tag]) =>
    Object.fromEntries([...tag.matchAll(/([\w:-]+)="([^"]*)"/g)]
      .map(([, key, content]) => [key, content])));
  return tags.find((tag) => tag[attribute] === value)?.content;
}

try {
  const origin = 'http://127.0.0.1:' + await freePort();
  const env = { ...process.env, CI: '1',
    DATABASE_URL: 'file:' + join(workspace, 'directory.db'),
    BETTER_AUTH_SECRET: randomBytes(32).toString('hex'),
    BETTER_AUTH_URL: origin, SITE_URL: origin };
  const command = (args) => {
    const result = spawnSync('npm', args, { env, encoding: 'utf8', timeout: 180_000 });
    expect(result.status === 0, args.join(' ') + ' failed: ' + (result.stderr || result.stdout));
  };
  const request = (path, headers = {}, options = {}) => fetch(new URL(path, origin),
    { redirect: 'manual', headers, ...options });
  const json = (body, cookie, method = 'POST') => ({ method,
    body: JSON.stringify(body), headers: {
      Origin: origin, 'Content-Type': 'application/json', Cookie: cookie,
    } });
  const write = (path, body, cookie, method = 'POST') => {
    const options = json(body, cookie, method);
    return request(path, options.headers, options);
  };
  async function card(path, label) {
    const images = [];
    for (const userAgent of ['facebookexternalhit/1.1', 'Twitterbot/1.0']) {
      const page = await request(path, { Accept: 'text/html', 'User-Agent': userAgent });
      expect(page.status === 200, label + ' page was HTTP ' + page.status);
      const html = await page.text();
      const og = meta(html, 'property', 'og:image');
      const twitter = meta(html, 'name', 'twitter:image');
      expect(og && og === twitter && og.startsWith(origin + '/'),
        label + ' lacked matching same-origin OG and X images');
      expect(meta(html, 'property', 'og:image:width') === '1200' &&
        meta(html, 'property', 'og:image:height') === '630' &&
        meta(html, 'name', 'twitter:image:width') === '1200' &&
        meta(html, 'name', 'twitter:image:height') === '630',
      label + ' lacked truthful 1200-by-630 image tags');
      expect(meta(html, 'name', 'twitter:card') === 'summary_large_image',
        label + ' was not a large-image X card');
      const response = await fetch(og, { headers: { 'User-Agent': userAgent } });
      expect(response.status === 200 && response.headers.get('content-type')?.startsWith('image/png'),
        label + ' image was unavailable as PNG');
      const etag = response.headers.get('etag');
      const cacheControl = response.headers.get('cache-control') ?? '';
      expect(etag && cacheControl.includes('must-revalidate') && !cacheControl.includes('no-store'),
        label + ' image did not advertise revision-aware caching');
      const bytes = Buffer.from(await response.arrayBuffer());
      const info = await sharp(bytes).metadata();
      expect(info.format === 'png' && info.width === 1200 && info.height === 630,
        label + ' image pixels were not 1200 by 630');
      const revalidated = await fetch(og, { headers: {
        'User-Agent': userAgent, 'If-None-Match': etag,
      } });
      expect(revalidated.status === 304,
        label + ' image did not revalidate its current revision');
      images.push({ url: og, bytes, etag });
    }
    expect(images[0].url === images[1].url &&
      images[0].bytes.equals(images[1].bytes), label + ' changed between crawlers');
    return images[0];
  }

  const cacheCheck = spawnSync(process.execPath,
    ['--import', 'tsx', '--test', 'tests/social-card-cache.test.mjs'],
    { env, encoding: 'utf8', timeout: 30_000 });
  expect(cacheCheck.status === 0,
    'Social card cache controls failed: ' + (cacheCheck.stderr || cacheCheck.stdout));
  command(['run', 'db:migrate']);
  command(['run', 'db:seed']);
  const password = randomBytes(20).toString('hex');
  command(['run', 'account:provision', '--', '--email', 'social-admin@example.invalid',
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

  const homeCard = await card('/', 'Fresh home');
  const listingIndexCard = await card('/listings', 'Fresh listing index');
  const articleIndexCard = await card('/articles', 'Fresh article index');
  const listingBefore = await card('/listings/example-tool', 'Fresh listing');
  expect(!homeCard.bytes.equals(listingIndexCard.bytes) &&
    !listingIndexCard.bytes.equals(articleIndexCard.bytes) &&
    !articleIndexCard.bytes.equals(listingBefore.bytes),
  'Fresh cards did not identify their own public pages');

  const signIn = await request('/api/auth/sign-in/email',
    { Origin: origin, 'Content-Type': 'application/json' },
    { method: 'POST', body: JSON.stringify({
      email: 'social-admin@example.invalid', password,
    }) });
  expect(signIn.ok, 'Admin sign-in failed: HTTP ' + signIn.status);
  const cookie = signIn.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
  expect(cookie, 'Admin sign-in returned no session');
  const articleCreated = await write('/api/admin/articles', {
    slug: 'social-article', title: 'Social Article', summary: 'Public summary',
    body: 'PUBLIC BODY', status: 'published', category: '', tags: [],
  }, cookie);
  expect(articleCreated.status === 201, 'Article fixture failed: HTTP ' + articleCreated.status);
  const articleVersion = (await articleCreated.json()).article.version;
  await card('/articles/social-article', 'Fresh article');

  const imageInput = await sharp({ create: {
    width: 80, height: 40, channels: 3, background: '#f43f5e',
  } }).png().toBuffer();
  const upload = await request('/api/admin/branding/assets', {
    Origin: origin, Cookie: cookie, 'Content-Type': 'image/png', 'X-Brand-Slot': 'social',
  }, { method: 'POST', body: imageInput });
  expect(upload.status === 201, 'Brand social-image upload failed: HTTP ' + upload.status);
  const listingWithOverride = await card('/listings/example-tool', 'Published brand override');
  expect(!listingBefore.bytes.equals(listingWithOverride.bytes),
    'A published custom image did not change the card');

  const articleBefore = await card('/articles/social-article', 'Article before draft');
  const saved = await write('/api/admin/articles/social-article', {
    action: 'save', version: articleVersion, title: 'Private staged title',
  }, cookie, 'PATCH');
  expect(saved.ok, 'Private revision fixture failed: HTTP ' + saved.status);
  const stagedCard = await card('/articles/social-article', 'Article before publication');
  expect(articleBefore.bytes.equals(stagedCard.bytes), 'Private revision changed the public card');
  const published = await write('/api/admin/articles/social-article', {
    action: 'publish', version: (await saved.json()).article.version,
  }, cookie, 'PATCH');
  expect(published.ok, 'Article publication failed: HTTP ' + published.status);
  const publishedVersion = (await published.json()).article.version;
  const publishedCard = await card('/articles/social-article', 'Article after publication');
  expect(stagedCard.url === publishedCard.url &&
    !stagedCard.bytes.equals(publishedCard.bytes),
  'Publishing the revision did not update the current public card');

  let privateHits = 0;
  spy = createServer((_request, response) => {
    privateHits += 1;
    response.writeHead(200, { 'Content-Type': 'image/png' });
    response.end(imageInput);
  });
  await new Promise((resolve) => spy.listen(0, '127.0.0.1', resolve));
  const privateUrl = 'http://127.0.0.1:' + spy.address().port + '/private.png';
  const settings = await write('/api/admin/seo/settings', {
    titleFormat: '%s', description: 'Social card default',
    socialImage: privateUrl, googleVerification: null, bingVerification: null,
  }, cookie, 'PATCH');
  expect(settings.ok, 'Private-network fixture failed: HTTP ' + settings.status);
  await card('/', 'Private-network fallback');
  expect(privateHits === 0, 'The social card server fetched a private-network URL');

  const unpublished = await write('/api/admin/articles/social-article', {
    action: 'unpublish', version: publishedVersion,
  }, cookie, 'PATCH');
  expect(unpublished.ok, 'Article unpublication failed: HTTP ' + unpublished.status);
  expect((await request('/articles/social-article')).status === 404 &&
    (await fetch(publishedCard.url)).status === 404,
  'Unpublished article or its card remained public');
  const suspended = await write('/api/admin/listings/example-tool/suspend',
    { reason: 'Social eligibility check' }, cookie);
  expect(suspended.ok, 'Listing suspension failed: HTTP ' + suspended.status);
  expect((await request('/listings/example-tool')).status === 404 &&
    (await fetch(listingBefore.url)).status === 404,
  'Suspended listing or its card remained public');
  passed = true;
} catch (error) {
  process.stderr.write('SEO-012: ' + error.message + '\n');
} finally {
  if (spy) await new Promise((resolve) => spy.close(resolve));
  if (app) { try { process.kill(-app.pid, 'SIGTERM'); } catch { /* stopped */ } }
  await new Promise((resolve) => setTimeout(resolve, 250));
  rmSync(workspace, { recursive: true, force: true });
  process.stdout.write('sudus: SEO-012: ' + (passed ? 'pass' : 'fail') + '\n');
}
