import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { XMLParser, XMLValidator } from 'fast-xml-parser';

const ids = ['SEO-003', 'SEO-004', 'SEO-005', 'DIR-005'];
const results = Object.fromEntries(ids.map((id) => [id, false]));
const workspace = mkdtempSync(join(tmpdir(), 'directory-crawl-check-'));
const articleBody = 'Visible body for crawl-article. </script><script id="json-ld-injection">alert(1)</script>';
let app;
let browser;
let origin;
let appEnv;
let adminCookie;

function requireCommand(args) {
  const result = spawnSync('npm', args, { env: appEnv, encoding: 'utf8', timeout: 120_000 });
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

async function prepareContent() {
  const password = randomBytes(20).toString('hex');
  requireCommand(['run', 'account:provision', '--', '--email', 'crawl-admin@example.invalid',
    '--password', password, '--role', 'admin', '--yes']);
  const signedIn = await request('/api/auth/sign-in/email',
    json({ email: 'crawl-admin@example.invalid', password }));
  adminCookie = cookieFrom(signedIn);
  if (!signedIn.ok || !adminCookie) throw new Error(`Admin sign-in returned ${signedIn.status}.`);
  for (const [slug, status] of [['crawl-article', 'published'], ['draft-article', 'draft']]) {
    const article = await request('/api/admin/articles', json({
      slug, title: `Article ${slug}`, summary: `Summary for ${slug}`,
      body: slug === 'crawl-article' ? articleBody : `Visible body for ${slug}.`, status, tags: [],
    }, adminCookie));
    if (article.status !== 201) throw new Error(`Article setup returned ${article.status}.`);
  }
  const longListing = await request('/api/admin/listings', json({
    slug: 'long-name', name: 'W'.repeat(120),
    summary: 'A published listing with a valid unbroken name.',
    description: 'This long name tests the narrow directory layout.',
    category: 'Tools', url: 'https://example.org/long-name', status: 'published',
  }, adminCookie));
  if (longListing.status !== 201) throw new Error(`Long-name setup returned ${longListing.status}.`);
}

function xmlEntries(xml) {
  if (XMLValidator.validate(xml) !== true) throw new Error('The sitemap is malformed XML.');
  const entries = new XMLParser().parse(xml).urlset?.url;
  return (Array.isArray(entries) ? entries : entries ? [entries] : []).map((entry) => entry.loc);
}

function htmlTag(html, name, attribute, value) {
  const candidates = html.match(new RegExp(`<${name}\\b[^>]*>`, 'gi')) ?? [];
  return candidates.find((candidate) =>
    new RegExp(`\\b${attribute}=["']${value}["']`, 'i').test(candidate)) ?? '';
}

function attribute(tag, name) {
  return tag.match(new RegExp(`\\b${name}=["']([^"']*)["']`, 'i'))?.[1] ?? '';
}

function jsonLd(html) {
  const matches = [...html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  return matches.map((match) => JSON.parse(match[1]));
}

async function check(id, run) {
  try {
    await run();
    results[id] = true;
  } catch (error) {
    process.stderr.write(`${id}: ${error.message}\n`);
  }
}

async function viewportMetrics(path, mode, width) {
  const context = await browser.newContext({ viewport: { width, height: 740 }, colorScheme: mode });
  try {
    const page = await context.newPage();
    await page.goto(`${origin}${path}`, { waitUntil: 'domcontentloaded' });
    const metrics = await page.evaluate(() => {
      const body = getComputedStyle(document.body);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const painter = canvas.getContext('2d');
      const rgb = (color) => {
        painter.clearRect(0, 0, 1, 1);
        painter.fillStyle = color;
        painter.fillRect(0, 0, 1, 1);
        return [...painter.getImageData(0, 0, 1, 1).data].slice(0, 3);
      };
      const lightness = (colors) => colors.map((value) => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
      const background = rgb(body.backgroundColor);
      const contrast = (foreground) => {
        const levels = [lightness(rgb(foreground)), lightness(background)].sort((a, b) => b - a);
        return (levels[0] + 0.05) / (levels[1] + 0.05);
      };
      const muted = document.querySelector('main .text-muted-foreground');
      return {
        width: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        heading: document.querySelector('main h1')?.textContent?.trim() ?? '',
        mainWidth: document.querySelector('main')?.getBoundingClientRect().width ?? 0,
        contrast: contrast(body.color),
        mutedContrast: muted ? contrast(getComputedStyle(muted).color) : 0,
        background: background.join(','),
      };
    });
    return metrics;
  } finally {
    await context.close();
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
  requireCommand(['run', 'db:seed']);
  requireCommand(['run', 'build']);
  await startApp();
  await prepareContent();

  await check('SEO-004', async () => {
    for (const path of ['/listings/not-a-listing', '/listings/hidden-draft', '/articles/draft-article']) {
      if ((await request(path)).status !== 404) throw new Error(`${path} is not a missing response.`);
    }
    for (const path of ['/listings?q=Example', '/listings?category=Tools', '/articles?page=2']) {
      const response = await request(path);
      const html = await response.text();
      const robots = attribute(htmlTag(html, 'meta', 'name', 'robots'), 'content');
      const canonical = attribute(htmlTag(html, 'link', 'rel', 'canonical'), 'href');
      if (!response.ok || !contains(robots, 'noindex') || canonical.includes('?')) {
        throw new Error(`${path} is indexable or declares a query URL canonical.`);
      }
    }
  });

  await check('SEO-005', async () => {
    const pages = [
      ['/listings/example-tool', 'Example Tool'],
      ['/articles/crawl-article', 'Article crawl-article'],
      ['/', 'Directory Starter'],
      ['/listings', 'Listings'],
      ['/articles', 'Articles'],
    ];
    for (const [path, visible] of pages) {
      const response = await request(path);
      const html = await response.text();
      const data = jsonLd(html);
      if (!response.ok || !contains(html, visible) || data.length === 0) {
        throw new Error(`${path} lacks visible content or structured data.`);
      }
      if (!data.some((entry) => entry['@context'] === 'https://schema.org' &&
          typeof entry['@type'] === 'string')) {
        throw new Error(`${path} has no typed schema.org data.`);
      }
      if (path === '/listings/example-tool' && !data.some((entry) =>
        entry.name === 'Example Tool' && entry.url === 'https://example.org/tool' &&
        entry.description === 'A sample link for your directory that operators can replace.')) {
        throw new Error('Listing structured data disagrees with its visible listing.');
      }
      if (path === '/articles/crawl-article' && !data.some((entry) =>
        entry.headline === 'Article crawl-article' && entry.description === 'Summary for crawl-article' &&
        entry.articleBody === articleBody && entry.url === `${origin}/articles/crawl-article`)) {
        throw new Error('Article structured data disagrees with its visible article.');
      }
      if (path === '/articles/crawl-article' && html.includes('<script id="json-ld-injection">')) {
        throw new Error('Article content terminates its JSON-LD script.');
      }
      if (['/', '/listings', '/articles'].includes(path) &&
          !data.some((entry) => entry.name === visible)) {
        throw new Error(`${path} structured name disagrees with its visible heading or site identity.`);
      }
      if (path === '/listings' && !data.some((entry) =>
        entry.mainEntity?.itemListElement?.some((item) =>
          item.name === 'Example Tool' && item.url === `${origin}/listings/example-tool`))) {
        throw new Error('Listing index structured links disagree with visible listings.');
      }
      if (path === '/articles' && !data.some((entry) =>
        entry.mainEntity?.itemListElement?.some((item) =>
          item.name === 'Article crawl-article' && item.url === `${origin}/articles/crawl-article`))) {
        throw new Error('Article index structured links disagree with visible articles.');
      }
    }
  });

  await check('DIR-005', async () => {
    browser = await chromium.launch({
      headless: true,
      ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
      args: ['--no-sandbox'],
    });
    for (const path of ['/listings', '/listings/example-tool', '/listings/long-name']) {
      const light = await viewportMetrics(path, 'light', 320);
      const dark = await viewportMetrics(path, 'dark', 320);
      for (const [mode, metrics] of [['light', light], ['dark', dark]]) {
        if (metrics.width !== 320 || metrics.scrollWidth > 320 || metrics.mainWidth > 320 ||
            !metrics.heading || metrics.contrast < 4.5 || metrics.mutedContrast < 4.5) {
          throw new Error(`${path} is clipped or unreadable at 320px in ${mode} mode: ${JSON.stringify(metrics)}.`);
        }
      }
      if (light.background === dark.background) {
        throw new Error(`${path} does not respond to light and dark preference.`);
      }
      const wide = await viewportMetrics(path, 'light', 1600);
      if (wide.width !== 1600 || wide.scrollWidth > 1600 ||
          wide.mainWidth < 1390 || wide.mainWidth > 1400) {
        throw new Error(`${path} does not respect the 1400px content cap: ${JSON.stringify(wide)}.`);
      }
    }
  });

  await check('SEO-003', async () => {
    const before = await request('/sitemap.xml');
    if (!before.ok) throw new Error('The sitemap route is missing.');
    const locations = xmlEntries(await before.text());
    const expected = ['/', '/listings', '/articles', '/listings/example-tool', '/articles/crawl-article']
      .map((path) => `${origin}${path}`);
    if (expected.some((url) => !locations.includes(url)) ||
        locations.some((url) => /hidden-draft|draft-article|\/admin\/|\/owner\/|\/api\//.test(url))) {
      throw new Error('The sitemap omits eligible pages or includes private or draft content.');
    }
    const robots = await request('/robots.txt');
    const policy = await robots.text();
    if (!robots.ok || !contains(policy, `Sitemap: ${origin}/sitemap.xml`) ||
        !contains(policy, 'Disallow: /admin/') || !contains(policy, 'Disallow: /owner/') ||
        !contains(policy, 'Disallow: /api/')) {
      throw new Error('The robots policy is missing private-route exclusions or the sitemap origin.');
    }
    const unpublished = await request('/api/admin/listings/example-tool',
      json({ status: 'draft' }, adminCookie, 'PATCH'));
    if (!unpublished.ok) throw new Error('Could not change listing eligibility for the sitemap check.');
    const after = xmlEntries(await (await request('/sitemap.xml')).text());
    if (after.includes(`${origin}/listings/example-tool`)) {
      throw new Error('The sitemap retains a listing after it becomes ineligible.');
    }
  });
} catch (error) {
  process.stderr.write(`Public crawl mechanism setup: ${error.message}\n`);
} finally {
  if (browser) await browser.close();
  await stopApp();
  rmSync(workspace, { recursive: true, force: true });
  for (const [id, ok] of Object.entries(results)) {
    process.stdout.write(`sudus: ${id}: ${ok ? 'pass' : 'fail'}\n`);
  }
}
