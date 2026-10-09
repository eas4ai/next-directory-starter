import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ids = ['FOUND-002', 'FOUND-003', 'FOUND-004', 'DIR-003', 'DIR-004'];
const results = Object.fromEntries(ids.map((id) => [id, false]));
const workspace = mkdtempSync(join(tmpdir(), 'directory-catalog-check-'));
let app;
let origin;
let appEnv;
let adminCookie;

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
const main = (html) => html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ?? '';
const contains = (html, text) => html.toLowerCase().includes(text.toLowerCase());

function json(body, cookie = adminCookie, method = 'POST') {
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

async function provision() {
  const email = 'catalog-admin@example.invalid';
  const password = randomBytes(20).toString('hex');
  requireCommand(['run', 'account:provision', '--', '--email', email, '--password', password, '--role', 'admin', '--yes']);
  const response = await request('/api/auth/sign-in/email', json({ email, password }, undefined));
  if (!response.ok) throw new Error(`Administrator sign-in returned ${response.status}.`);
  adminCookie = response.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
  if (!adminCookie) throw new Error('Administrator sign-in established no session.');
}

async function createListing(slug, overrides = {}) {
  const listing = {
    slug,
    name: `Catalog ${slug}`,
    summary: `Summary for ${slug}`,
    description: `Description for ${slug}`,
    category: 'Tools',
    url: `https://example.org/${slug}`,
    status: 'published',
    ...overrides,
  };
  const response = await request('/api/admin/listings', json(listing));
  if (response.status !== 201) throw new Error(`Listing creation returned ${response.status}.`);
  return listing;
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
    DATABASE_URL: `file:${join(workspace, 'catalog.db')}`,
    BETTER_AUTH_SECRET: randomBytes(32).toString('hex'),
    BETTER_AUTH_URL: origin,
    SITE_URL: origin,
    SITE_NAME: 'Operator Test Directory',
    SITE_DESCRIPTION: 'A directory chosen by its operator.',
    SITE_LOGO_URL: 'https://example.org/operator-logo.svg',
  };
  requireCommand(['run', 'db:migrate']);
  const seed = command(['run', 'db:seed']);
  requireCommand(['run', 'build']);
  await startApp();

  await check('FOUND-002', async () => {
    const response = await request('/');
    const html = await response.text();
    const header = html.match(/<header\b[^>]*>([\s\S]*?)<\/header>/i)?.[1] ?? '';
    const title = html.match(/<title>([^<]*)<\/title>/i)?.[1] ?? '';
    const description = html.match(/<meta\b[^>]*name="description"[^>]*>/i)?.[0] ?? '';
    if (!response.ok || !contains(header, appEnv.SITE_NAME) ||
        !contains(title, appEnv.SITE_NAME) ||
        !contains(description, appEnv.SITE_DESCRIPTION) ||
        !header.includes(appEnv.SITE_LOGO_URL)) {
      throw new Error('Configured identity is absent from the header or page metadata.');
    }
  });

  await check('FOUND-003', async () => {
    if (seed.status !== 0) throw new Error('The documented db:seed command failed.');
    const guide = readFileSync('README.md', 'utf8');
    if (!guide.includes('npm run db:migrate') || !guide.includes('npm run db:seed')) {
      throw new Error('The first-run guide omits migration or sample seeding.');
    }
    const response = await request('/listings');
    const html = await response.text();
    if (!response.ok || !contains(main(html), 'Example Tool') || contains(html, 'DevList')) {
      throw new Error('A fresh seeded directory is not browsable or contains DevList branding.');
    }
  });

  try { await provision(); } catch (error) { process.stderr.write(`Admin setup: ${error.message}\n`); }

  await check('FOUND-004', async () => {
    if (!adminCookie) throw new Error('An administrator cannot create content.');
    const editor = await request('/admin/catalog', { headers: { Cookie: adminCookie } });
    if (!editor.ok || !/name=["']name["']/.test(await editor.text())) {
      throw new Error('The operator listing editor is absent.');
    }
    const guest = await request('/api/admin/listings', json({ slug: 'guest-entry' }, ''));
    if (![401, 403].includes(guest.status)) throw new Error('A visitor can create operator content.');
    const listing = await createListing('persistent-entry');
    await stopApp();
    await startApp();
    const response = await request(`/listings/${listing.slug}`);
    if (!response.ok || !contains(await response.text(), listing.name)) {
      throw new Error('An operator-created listing did not survive restart.');
    }
  });

  await check('DIR-003', async () => {
    const missing = await request('/listings?q=no-such-listing');
    if (!missing.ok || contains(main(await missing.text()), 'Example Tool')) {
      throw new Error('A nonmatching query still shows a listing.');
    }
    const category = await request('/listings?category=no-such-category');
    if (!category.ok || contains(main(await category.text()), 'Example Tool')) {
      throw new Error('A nonmatching category still shows a listing.');
    }
    const tools = await request('/listings?category=Tools');
    if (!tools.ok || !contains(main(await tools.text()), 'Example Tool')) {
      throw new Error('A matching category omits its listing.');
    }
    if (!adminCookie) throw new Error('Cannot verify pagination without operator-created listings.');
    for (let index = 0; index < 15; index += 1) {
      await createListing(`search-entry-${index}`);
    }
    const first = await request('/listings?page=1');
    const second = await request('/listings?page=2');
    const firstHtml = main(await first.text());
    const secondHtml = main(await second.text());
    const firstCount = [...firstHtml.matchAll(/href="\/listings\/[^"?#]+"/g)].length;
    if (!first.ok || !second.ok || firstCount > 12 ||
        !secondHtml.includes('/listings/search-entry-')) {
      throw new Error('Pagination exceeded the 12-listing bound or omitted a second page.');
    }
    const chosen = await request('/listings?q=search-entry-14');
    const chosenMain = main(await chosen.text());
    if (!chosen.ok || !contains(chosenMain, 'Catalog search-entry-14') ||
        contains(chosenMain, 'Catalog search-entry-13')) {
      throw new Error('Query filtering omitted a match or included a nonmatch.');
    }
  });

  await check('DIR-004', async () => {
    if (!adminCookie) throw new Error('Cannot change publication state.');
    const listing = await createListing('withdrawn-entry');
    const change = await request(`/api/admin/listings/${listing.slug}`, json({ status: 'draft' }, adminCookie, 'PATCH'));
    if (!change.ok) throw new Error(`Publication change returned ${change.status}.`);
    const [index, filtered, detail] = await Promise.all([
      request('/listings'), request(`/listings?q=${listing.slug}`),
      request(`/listings/${listing.slug}`),
    ]);
    if (contains(main(await index.text()), listing.name) ||
        contains(main(await filtered.text()), listing.name) || detail.status !== 404) {
      throw new Error('An ineligible listing remains on a public route.');
    }
  });
} catch (error) {
  process.stderr.write(`Catalog mechanism setup: ${error.message}\n`);
} finally {
  await stopApp();
  rmSync(workspace, { recursive: true, force: true });
  for (const [id, ok] of Object.entries(results)) {
    process.stdout.write(`sudus: ${id}: ${ok ? 'pass' : 'fail'}\n`);
  }
}
