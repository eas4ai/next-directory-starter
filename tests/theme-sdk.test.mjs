import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { chromium } from 'playwright-core';

let runtime;

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function command(env, args) {
  const result = spawnSync('npm', args, { env, encoding: 'utf8', timeout: 120_000 });
  assert.equal(result.status, 0, `${args.join(' ')} failed: ${result.stderr || result.stdout}`);
}

async function app() {
  if (runtime) return runtime;
  const directory = mkdtempSync(join(tmpdir(), 'directory-theme-sdk-'));
  const origin = `http://127.0.0.1:${await freePort()}`;
  const password = randomBytes(20).toString('hex');
  const env = { ...process.env, CI: '1', DATABASE_URL: `file:${join(directory, 'directory.db')}`,
    SITE_URL: origin, BETTER_AUTH_URL: origin,
    BETTER_AUTH_SECRET: randomBytes(32).toString('hex') };
  runtime = { directory, origin, env, process: null, password, adminCookie: '' };
  // Each acceptance run needs its own clean generated build state.
  rmSync('.next', { recursive: true, force: true });
  command(env, ['run', 'build']);
  command(env, ['run', 'db:migrate']);
  command(env, ['run', 'db:seed']);
  command(env, ['run', 'account:provision', '--', '--email',
    'theme-sdk-admin@example.invalid', '--password', password, '--role', 'admin', '--yes']);
  runtime.process = spawn('npm', ['run', 'start', '--', '-p', new URL(origin).port], {
    env, detached: true, stdio: 'ignore',
  });
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      if ((await fetch(origin, { signal: AbortSignal.timeout(1000) })).status < 500) {
        ready = true;
        break;
      }
    } catch { /* wait for startup */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.ok(ready, 'application did not start');
  const signed = await fetch(`${origin}/api/auth/sign-in/email`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ email: 'theme-sdk-admin@example.invalid', password }),
  });
  assert.equal(signed.status, 200, await signed.text());
  runtime.adminCookie = signed.headers.getSetCookie()
    .map((value) => value.split(';')[0]).join('; ');
  assert.ok(runtime.adminCookie);
  return runtime;
}

async function restartApp() {
  const current = await app();
  process.kill(-current.process.pid, 'SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 500));
  current.process = spawn('npm', ['run', 'start', '--', '-p', new URL(current.origin).port], {
    env: current.env, detached: true, stdio: 'ignore',
  });
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      if ((await fetch(current.origin, { signal: AbortSignal.timeout(1000) })).status < 500) return;
    } catch { /* wait for restart */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.fail('application did not restart');
}

function selectionRequest(origin, cookie, selection) {
  return fetch(`${origin}/api/admin/theme/selection`, {
    method: 'PATCH', headers: { Cookie: cookie, Origin: origin,
      'Content-Type': 'application/json' },
    body: JSON.stringify(selection),
  });
}

after(() => {
  if (!runtime) return;
  try { if (runtime.process) process.kill(-runtime.process.pid, 'SIGTERM'); }
  catch { /* already exited */ }
  rmSync(runtime.directory, { recursive: true, force: true });
});

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.tsx?$/.test(path) ? [path] : [];
  });
}

test('THM-001 typed tokens validate and render a custom theme', async () => {
  const { defineTheme, renderThemeCss, installedThemes } =
    await import('../src/lib/theme-sdk.ts');
  const { defaultThemePreset } = await import('../src/lib/theme.ts');
  assert.equal(typeof defineTheme, 'function');
  assert.equal(typeof renderThemeCss, 'function');
  assert.ok(installedThemes.studio, 'a custom example theme must be installed');
  const css = renderThemeCss(defaultThemePreset, 'studio', ':root');
  for (const token of ['--background:', '--foreground:', '--primary:',
    '--theme-page-width:', '--theme-space-section:', '--preset-body-font:',
    '--preset-shadow:']) assert.ok(css.includes(token), `${token} is missing`);
  assert.match(css, /data-mode="dark"/);
  const broken = structuredClone(installedThemes.studio);
  delete broken.light.primary;
  assert.throws(() => defineTheme(broken), /primary|token/i);
  const { origin, adminCookie } = await app();
  const presetResponse = await fetch(`${origin}/theme.css`);
  assert.equal(presetResponse.status, 200);
  assert.match(presetResponse.headers.get('content-type') ?? '', /text\/css/);
  assert.match(presetResponse.headers.get('cache-control') ?? '', /no-store/);
  const presetCss = await presetResponse.text();
  const selected = await fetch(`${origin}/api/admin/theme/selection`, {
    method: 'PATCH', headers: { Cookie: adminCookie, Origin: origin,
      'Content-Type': 'application/json' },
    body: JSON.stringify({ themeId: 'studio', templateId: 'classic' }),
  });
  assert.equal(selected.status, 200, await selected.text());
  const studioCss = await (await fetch(`${origin}/theme.css`)).text();
  assert.notEqual(studioCss, presetCss);
  assert.match(studioCss, /--background: #f7f4ed/);
  for (const path of ['/listings', '/admin/theme']) {
    const response = await fetch(`${origin}${path}`, {
      headers: path.startsWith('/admin') ? { Cookie: adminCookie } : {},
    });
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /data-theme="studio"/);
    assert.match(html, /href="\/theme\.css"/);
  }
  const browser = await chromium.launch({ headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
    args: ['--no-sandbox'] });
  try {
    for (const [path, mode, background] of [
      ['/listings', 'light', 'rgb(247, 244, 237)'],
      ['/admin/theme', 'dark', 'rgb(16, 35, 33)'],
    ]) {
      const context = await browser.newContext({ colorScheme: mode });
      await context.addCookies([
        { name: 'site_appearance', value: mode, url: origin },
        ...adminCookie.split('; ').map((part) => {
          const at = part.indexOf('=');
          return { name: part.slice(0, at), value: part.slice(at + 1), url: origin };
        }),
      ]);
      const page = await context.newPage();
      await page.goto(`${origin}${path}`);
      assert.equal(await page.locator('body').evaluate((element) =>
        getComputedStyle(element).backgroundColor), background);
      await context.close();
    }
  } finally { await browser.close(); }
});

test('THM-002 stylesheets, preview, selection, restart and narrow layouts', async () => {
  for (const path of sourceFiles('src')) {
    const code = readFileSync(path, 'utf8');
    assert.doesNotMatch(code, /<style(?:\s|>)/i, `${path} authors a style element`);
    assert.doesNotMatch(code, /\bstyle\s*=\s*(?:\{|["'])/i,
      `${path} authors a style attribute`);
  }
  assert.ok(existsSync('src/app/theme.css/route.ts'), 'theme stylesheet route is missing');
  assert.ok(existsSync('src/app/api/admin/theme/selection/route.ts'),
    'protected selection route is missing');
  const layout = readFileSync('src/app/layout.tsx', 'utf8');
  assert.match(layout, /<link\b[^>]*href=["']\/theme\.css["']/);
  assert.match(layout, /data-template=/);
  const { origin, adminCookie } = await app();
  const forbidden = await selectionRequest(origin, '',
    { themeId: 'studio', templateId: 'editorial' });
  assert.equal(forbidden.status, 403);
  const invalid = await selectionRequest(origin, adminCookie,
    { themeId: 'missing', templateId: 'editorial' });
  assert.equal(invalid.status, 400);
  const reset = await selectionRequest(origin, adminCookie,
    { themeId: 'preset', templateId: 'classic' });
  assert.equal(reset.status, 200);
  const previewQuery = new URLSearchParams({
    preset: JSON.stringify((await import('../src/lib/theme.ts')).defaultThemePreset),
    themeId: 'studio', scope: 'selection',
  });
  assert.equal((await fetch(`${origin}/api/admin/theme/preview.css?${previewQuery}`)).status, 403);
  const preview = await fetch(`${origin}/api/admin/theme/preview.css?${previewQuery}`,
    { headers: { Cookie: adminCookie } });
  assert.equal(preview.status, 200);
  assert.match(preview.headers.get('cache-control') ?? '', /no-store/);
  assert.match(await preview.text(), /--background: #f7f4ed/);

  const browser = await chromium.launch({ headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
    args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({ viewport: { width: 1200, height: 800 } });
    await context.addCookies(adminCookie.split('; ').map((part) => {
      const at = part.indexOf('=');
      return { name: part.slice(0, at), value: part.slice(at + 1), url: origin };
    }));
    const page = await context.newPage();
    await page.goto(`${origin}/listings`);
    const beforeText = await page.locator('main').innerText();
    const beforeCanonical = await page.locator('link[rel=canonical]').getAttribute('href');
    await page.goto(`${origin}/admin/theme`);
    await page.selectOption('select[name=themeId]', 'studio');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.selection-preview .theme-preview-body')).backgroundColor === 'rgb(247, 244, 237)');
    await page.selectOption('select[name=templateId]', 'editorial');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.selection-preview .theme-preview-body')).display === 'grid');
    await page.getByRole('button', { name: 'Apply design' }).click();
    await page.getByRole('status').filter({ hasText: 'Theme and template saved.' }).waitFor();
    await page.goto(`${origin}/listings`);
    assert.equal(await page.locator('html').getAttribute('data-template'), 'editorial');
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'studio');
    assert.equal(await page.locator('main').innerText(), beforeText);
    assert.equal(await page.locator('link[rel=canonical]').getAttribute('href'), beforeCanonical);
    const columns = await page.locator('[data-testid=ordinary-results]').evaluate((element) =>
      getComputedStyle(element).gridTemplateColumns.split(' ').length);
    assert.equal(columns, 3, 'editorial template must change the result grid');
    await context.close();
    for (const mode of ['light', 'dark']) {
      const narrow = await browser.newContext({ viewport: { width: 320, height: 740 }, colorScheme: mode });
      await narrow.addCookies([{ name: 'site_appearance', value: mode, url: origin }]);
      const narrowPage = await narrow.newPage();
      for (const path of ['/', '/listings', '/listings/example-tool', '/articles']) {
        await narrowPage.goto(`${origin}${path}`);
        const metrics = await narrowPage.evaluate(() => ({
          width: document.documentElement.scrollWidth,
          text: document.querySelector('main')?.textContent?.trim() ?? '',
        }));
        assert.ok(metrics.width <= 320, `${path} overflows in ${mode} mode`);
        assert.ok(metrics.text.length > 0, `${path} has no visible content`);
      }
      await narrow.close();
    }
  } finally { await browser.close(); }
  await restartApp();
  const saved = await fetch(`${origin}/api/admin/theme/selection`,
    { headers: { Cookie: adminCookie } });
  assert.deepEqual((await saved.json()).selection,
    { themeId: 'studio', templateId: 'editorial' });
  assert.match(await (await fetch(`${origin}/listings`)).text(), /data-template="editorial"/);
});

test('THM-003 skill and example extensions are usable', () => {
  const skill = '.agents/skills/create-directory-theme/SKILL.md';
  assert.ok(existsSync(skill), 'agent skill is missing');
  const instructions = readFileSync(skill, 'utf8');
  assert.match(instructions, /^---\nname: create-directory-theme\ndescription: .+\n---\n/);
  for (const item of ['token', 'template', 'brand', 'preview', 'build']) {
    assert.match(instructions, new RegExp(item, 'i'), `${item} guidance is missing`);
  }
  assert.ok(existsSync('src/themes/studio.ts'), 'example theme is missing');
  assert.ok(existsSync('src/templates/editorial.css'), 'example template is missing');
});

test('THM-004 branding has protected settings and asset paths', () => {
  assert.ok(existsSync('src/lib/branding.ts'), 'brand settings are missing');
  assert.ok(existsSync('src/app/api/admin/branding/route.ts'), 'brand API is missing');
  assert.ok(existsSync('src/app/api/admin/branding/assets/route.ts'),
    'validated brand asset upload is missing');
  const card = readFileSync('src/lib/agent-cards.ts', 'utf8');
  assert.match(card, /getSiteConfig|branding/);
  assert.match(card, /theme|token|palette/i);
});
