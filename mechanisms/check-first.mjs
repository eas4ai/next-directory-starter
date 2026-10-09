import { spawn, spawnSync } from 'node:child_process';
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
const run = (command, args) => spawnSync(command, args, {
  encoding: 'utf8',
  timeout: 120_000,
  env: { ...process.env, CI: '1' },
});
const text = (value) => typeof value === 'string' ? value : '';
const contains = (html, value) => html.toLowerCase().includes(value.toLowerCase());
const main = (html) => html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ?? '';

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
  const next = text(deps.next).match(/(\d+)\.(\d+)\.(\d+)/);
  const currentAtStart = next && (Number(next[1]) > 16 ||
    (Number(next[1]) === 16 && Number(next[2]) >= 4));
  const uiPath = ['src/components/ui', 'components/ui'].find(existsSync);
  const hasUi = uiPath && readdirSync(uiPath).some((name) => name.endsWith('.tsx'));
  result['FOUND-001'] = Boolean(currentAtStart && deps.react && deps['react-dom'] &&
    deps.typescript && config.tailwind?.cssVariables === true && hasUi &&
    run('npm', ['run', 'build']).status === 0);
}

async function checkPublic(origin) {
  const index = await fetch(`${origin}/listings`);
  const detail = await fetch(`${origin}/listings/example-tool`);
  const draft = await fetch(`${origin}/listings/hidden-draft`);
  const indexHtml = await index.text();
  const detailHtml = await detail.text();
  const indexMain = main(indexHtml);
  const detailMain = main(detailHtml);
  const indexContent = index.ok && contains(indexMain, 'Example Tool') &&
    contains(indexMain, 'A sample link for your directory') &&
    contains(indexMain, 'Tools') && !contains(indexMain, 'Hidden Draft');
  const detailContent = detail.ok && contains(detailMain, 'Example Tool') &&
    contains(detailMain, 'A sample link for your directory') &&
    contains(detailMain, 'Tools') && contains(detailMain, 'https://example.org/tool');

  if (group === 'directory') {
    result['DIR-001'] = indexContent && draft.status === 404;
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
    const dt = canonical(detailHtml);
    result['SEO-002'] = Boolean(index.ok && detail.ok && title(indexHtml) &&
      title(detailHtml) && contains(title(detailHtml), 'Example Tool') &&
      desc(indexHtml) && desc(detailHtml) && ix === `${origin}/listings` &&
      dt === `${origin}/listings/example-tool` && ix !== dt &&
      ogTitle(indexHtml) && contains(ogTitle(detailHtml), 'Example Tool') &&
      ogDescription(indexHtml) && ogDescription(detailHtml) &&
      ogUrl(indexHtml) === ix && ogUrl(detailHtml) === dt);
  }
}

function checkTheme() {
  for (const id of groups.theme) {
    const test = run('node', ['--test', '--test-name-pattern', id, 'tests/admin-theme.test.mjs']);
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
