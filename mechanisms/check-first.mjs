import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createServer } from 'node:net';

const groups = {
  foundation: ['FOUND-001'],
  directory: ['DIR-001', 'DIR-002'],
  seo: ['SEO-001', 'SEO-002'],
  theme: ['ADM-004', 'ADM-005', 'ADM-006', 'ADM-007'],
};
const group = process.argv[2];
if (!(group in groups)) {
  process.stderr.write('Expected foundation, directory, seo, or theme.\n');
  process.exit(2);
}

const result = Object.fromEntries(groups[group].map((id) => [id, false]));
const run = (command, args, extraEnv = {}) => spawnSync(command, args, {
  encoding: 'utf8',
  timeout: 120_000,
  env: { ...process.env, CI: '1', ...extraEnv },
});
const text = (value) => typeof value === 'string' ? value : '';
const contains = (html, value) => html.toLowerCase().includes(value.toLowerCase());
const main = (html) => html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ?? '';
const atLeast = (value, floor) => {
  const version = text(value).match(/(\d+)\.(\d+)\.(\d+)/)?.slice(1).map(Number);
  if (!version) return false;
  for (let part = 0; part < 3; part += 1) {
    if (version[part] !== floor[part]) return version[part] > floor[part];
  }
  return true;
};

function tag(html, name, attribute, value) {
  const tags = html.match(new RegExp(`<${name}\\b[^>]*>`, 'gi')) ?? [];
  return tags.find((candidate) => new RegExp(`\\b${attribute}=["']${value}["']`, 'i').test(candidate)) ?? '';
}

function attribute(tagText, name) {
  return tagText.match(new RegExp(`\\b${name}=["']([^"']*)["']`, 'i'))?.[1] ?? '';
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function withApp(check) {
  if (!existsSync('package.json') || run('npm', ['run', 'build']).status !== 0) return;
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const server = spawn('npm', ['run', 'start', '--', '-p', String(port)], {
    env: { ...process.env, CI: '1', NEXT_PUBLIC_SITE_URL: origin, SITE_URL: origin },
    detached: true,
    stdio: 'ignore',
  });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (server.exitCode !== null) break;
      try {
        const response = await fetch(origin, { signal: AbortSignal.timeout(1000) });
        if (response.status < 500) { ready = true; break; }
      } catch { /* wait for the server */ }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (ready) await check(origin);
  } finally {
    try { process.kill(-server.pid, 'SIGTERM'); } catch { /* already exited */ }
  }
}

async function checkFoundation() {
  if (!existsSync('package.json') || !existsSync('components.json')) return;
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  const config = JSON.parse(readFileSync('components.json', 'utf8'));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const currentAtStart = atLeast(deps.next, [16, 4, 0]) &&
    atLeast(deps.react, [19, 3, 0]) &&
    atLeast(deps['react-dom'], [19, 3, 0]) &&
    atLeast(deps.shadcn, [4, 21, 4]);
  const uiPath = ['src/components/ui', 'components/ui'].find(existsSync);
  const hasUi = uiPath && readdirSync(uiPath).some((name) => name.endsWith('.tsx'));
  const buildEnv = {
    SITE_URL: process.env.SITE_URL || 'http://localhost:3000',
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL || 'http://localhost:3000',
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET || randomBytes(32).toString('hex'),
  };
  result['FOUND-001'] = Boolean(currentAtStart && deps.typescript &&
    config.tailwind?.cssVariables === true && hasUi &&
    run('npm', ['run', 'build'], buildEnv).status === 0);
}

async function checkPublic(origin) {
  const samples = JSON.parse(readFileSync('fixtures/sample-listings.json', 'utf8'));
  const published = samples.filter((listing) => listing.status === 'published');
  const drafts = samples.filter((listing) => listing.status === 'draft');
  if (published.length === 0) return;

  const index = await fetch(`${origin}/listings`);
  const indexHtml = await index.text();
  const indexMain = main(indexHtml);
  const details = await Promise.all(published.map(async (listing) => {
    const response = await fetch(`${origin}/listings/${encodeURIComponent(listing.slug)}`);
    return { listing, response, html: await response.text() };
  }));
  const draftStatuses = await Promise.all(drafts.map(async (listing) =>
    (await fetch(`${origin}/listings/${encodeURIComponent(listing.slug)}`)).status));
  const indexContent = index.ok && published.every((listing) =>
    contains(indexMain, listing.title) && contains(indexMain, listing.summary) &&
    contains(indexMain, listing.category) &&
    indexHtml.includes(`href="/listings/${encodeURIComponent(listing.slug)}"`)) &&
    drafts.every((listing) => !contains(indexMain, listing.title));
  const detailContent = details.every(({ listing, response, html }) => {
    const detailMain = main(html);
    return response.ok && contains(detailMain, listing.title) &&
      contains(detailMain, listing.summary) && contains(detailMain, listing.description) &&
      contains(detailMain, listing.category) &&
      detailMain.includes(listing.url.replaceAll('&', '&amp;'));
  });

  if (group === 'directory') {
    result['DIR-001'] = indexContent && draftStatuses.every((status) => status === 404);
    result['DIR-002'] = detailContent;
  } else {
    result['SEO-001'] = indexContent && detailContent;
    const title = (html) => html.match(/<title>([^<]+)<\/title>/i)?.[1] ?? '';
    const desc = (html) => attribute(tag(html, 'meta', 'name', 'description'), 'content');
    const canonical = (html) => attribute(tag(html, 'link', 'rel', 'canonical'), 'href');
    const ogTitle = (html) => attribute(tag(html, 'meta', 'property', 'og:title'), 'content');
    const ogDescription = (html) => attribute(tag(html, 'meta', 'property', 'og:description'), 'content');
    const ogUrl = (html) => attribute(tag(html, 'meta', 'property', 'og:url'), 'content');
    const ix = canonical(indexHtml);
    const detailMetadata = details.every(({ listing, response, html }) => {
      const expectedUrl = `${origin}/listings/${encodeURIComponent(listing.slug)}`;
      return response.ok && contains(title(html), listing.title) &&
        desc(html) === listing.summary && canonical(html) === expectedUrl &&
        contains(ogTitle(html), listing.title) &&
        ogDescription(html) === listing.summary && ogUrl(html) === expectedUrl;
    });
    const originTest = run('node', ['--import', 'tsx', '--test', '--test-reporter=tap', 'tests/page-metadata.test.mjs']);
    result['SEO-002'] = Boolean(index.ok && title(indexHtml) && desc(indexHtml) &&
      ix === `${origin}/listings` && ogTitle(indexHtml) &&
      ogDescription(indexHtml) && ogUrl(indexHtml) === ix && detailMetadata &&
      originTest.status === 0 && /^# pass [1-9]\d*$/m.test(text(originTest.stdout)) &&
      /^# fail 0$/m.test(text(originTest.stdout)));
  }
}

function checkTheme() {
  for (const id of groups.theme) {
    const test = run('node', ['--test', '--test-reporter=tap', '--test-name-pattern', id, 'tests/admin-theme.test.mjs']);
    result[id] = test.status === 0 && /^# pass [1-9]\d*$/m.test(text(test.stdout)) &&
      /^# fail 0$/m.test(text(test.stdout));
  }
}

try {
  if (group === 'foundation') await checkFoundation();
  else if (group === 'theme') checkTheme();
  else await withApp(checkPublic);
} catch (error) {
  process.stderr.write(`${text(error?.message) || 'Mechanism failed'}\n`);
}
for (const [id, ok] of Object.entries(result)) {
  process.stdout.write(`sudus: ${id}: ${ok ? 'pass' : 'fail'}\n`);
}
