import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

function run(env, args) {
  const result = spawnSync('npm', args, { env, encoding: 'utf8', timeout: 180_000 });
  assert.equal(result.status, 0, `${args.join(' ')} failed: ${result.stderr || result.stdout}`);
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function ready(origin) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      if ((await fetch(origin, { signal: AbortSignal.timeout(1000) })).status < 500) return;
    } catch { /* wait for startup */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.fail('application did not start');
}

async function pageFonts(page) {
  await page.evaluate(() => document.fonts.ready);
  return page.evaluate(() => {
    const body = getComputedStyle(document.documentElement).fontFamily.split(',')[0]
      .trim().replace(/^['"]|['"]$/g, '');
    const heading = getComputedStyle(document.querySelector('[data-slot="card-title"]'))
      .fontFamily.split(',')[0].trim().replace(/^['"]|['"]$/g, '');
    const faces = [...document.fonts].map((face) => ({
      family: face.family.replace(/^['"]|['"]$/g, ''), status: face.status,
    }));
    return { body, heading, faces };
  });
}

let passed = false;
let directory;
let server;
let browser;
let database;
const previousDatabaseUrl = process.env.DATABASE_URL;
try {
  directory = mkdtempSync(join(tmpdir(), 'directory-font-loading-'));
  process.env.DATABASE_URL = `file:${join(directory, 'directory.db')}`;
  ({ database } = await import('../src/lib/database.ts'));
  const { defaultThemePreset, themeOptions } = await import('../src/lib/theme.ts');
  const { installedThemes, renderThemeCss } = await import('../src/lib/theme-sdk.ts');
  const names = new Set();
  for (const font of themeOptions.font) {
    const css = renderThemeCss({ ...defaultThemePreset, font }, 'preset', ':root');
    assert.doesNotMatch(css, /@import|fonts\.googleapis\.com/i,
      `preset body font ${font} requests a blocking stylesheet`);
    const family = /--preset-body-font:\s*([^;]+);/.exec(css)?.[1];
    assert.ok(family && family !== 'ui-sans-serif', `${font} has no body font`);
    names.add(family);
  }
  assert.equal(names.size, themeOptions.font.length, 'preset body fonts must remain distinct');
  names.clear();
  for (const fontHeading of themeOptions.fontHeading.filter((font) => font !== 'inherit')) {
    const css = renderThemeCss({ ...defaultThemePreset, fontHeading }, 'preset', ':root');
    assert.doesNotMatch(css, /@import|fonts\.googleapis\.com/i,
      `preset heading font ${fontHeading} requests a blocking stylesheet`);
    const family = /--preset-heading-font:\s*([^;]+);/.exec(css)?.[1];
    assert.ok(family && family !== 'ui-sans-serif', `${fontHeading} has no heading font`);
    names.add(family);
  }
  assert.equal(names.size, themeOptions.fontHeading.length - 1,
    'preset heading fonts must remain distinct');
  const customCss = renderThemeCss(defaultThemePreset, 'studio', ':root');
  assert.doesNotMatch(customCss, /@import|fonts\.googleapis\.com/i);
  assert.ok(customCss.includes(`--preset-body-font: ${installedThemes.studio.typography.body};`));
  assert.ok(customCss.includes(`--preset-heading-font: ${installedThemes.studio.typography.heading};`));

  const origin = `http://127.0.0.1:${await freePort()}`;
  const password = randomBytes(20).toString('hex');
  const env = { ...process.env, CI: '1', DATABASE_URL: `file:${join(directory, 'directory.db')}`,
    SITE_URL: origin, BETTER_AUTH_URL: origin,
    BETTER_AUTH_SECRET: randomBytes(32).toString('hex') };
  rmSync('.next', { recursive: true, force: true });
  run(env, ['run', 'db:migrate']);
  run(env, ['run', 'build', '--', '--webpack']);
  run(env, ['run', 'db:seed']);
  run(env, ['run', 'account:provision', '--', '--email',
    'font-admin@example.invalid', '--password', password, '--role', 'admin', '--yes']);
  const start = () => spawn('npm', ['run', 'start', '--', '-p', new URL(origin).port], {
    env, detached: true, stdio: 'ignore',
  });
  server = start();
  await ready(origin);
  const signed = await fetch(`${origin}/api/auth/sign-in/email`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ email: 'font-admin@example.invalid', password }),
  });
  assert.equal(signed.status, 200, await signed.text());
  const cookie = signed.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
  assert.ok(cookie);
  const savePreset = async (preset) => {
    const response = await fetch(`${origin}/api/admin/theme`, {
      method: 'POST', headers: { Cookie: cookie, Origin: origin,
        'Content-Type': 'application/json' }, body: JSON.stringify(preset),
    });
    assert.equal(response.status, 200, await response.text());
  };
  browser = await chromium.launch({ headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
    args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addCookies(cookie.split('; ').map((part) => {
    const at = part.indexOf('=');
    return { name: part.slice(0, at), value: part.slice(at + 1), url: origin };
  }));
  const page = await context.newPage();
  const fontStylesheets = [];
  page.on('request', (request) => {
    if (/fonts\.googleapis\.com.*\/css/i.test(request.url())) fontStylesheets.push(request.url());
  });
  for (const path of ['/', '/listings', '/admin/theme']) {
    const response = await page.goto(`${origin}${path}`);
    assert.equal(response.status(), 200, `${path} failed`);
    assert.ok((await page.locator('body').innerText()).trim(), `${path} has no visible text`);
  }
  assert.deepEqual(fontStylesheets, [], 'initial pages request Google font CSS');
  await page.goto(`${origin}/listings`);
  const before = await pageFonts(page);
  for (const family of [before.body, before.heading]) {
    assert.ok(before.faces.some((face) => face.family === family && face.status === 'loaded'),
      `${family} did not load`);
  }
  const changed = { ...defaultThemePreset, font: 'lora', fontHeading: 'jetbrains-mono' };
  await savePreset(changed);
  await page.goto(`${origin}/listings`);
  const after = await pageFonts(page);
  assert.notEqual(after.body, before.body, 'saved body font did not change');
  assert.notEqual(after.heading, before.heading, 'saved heading font did not change');
  for (const family of [after.body, after.heading]) {
    assert.ok(after.faces.some((face) => face.family === family && face.status === 'loaded'),
      `${family} did not load`);
  }
  process.kill(-server.pid, 'SIGTERM');
  server = null;
  await new Promise((resolve) => setTimeout(resolve, 500));
  server = start();
  await ready(origin);
  const saved = await fetch(`${origin}/api/admin/theme`, { headers: { Cookie: cookie } });
  assert.deepEqual((await saved.json()).preset, changed, 'saved fonts changed after restart');
  await page.goto(`${origin}/listings`);
  const restarted = await pageFonts(page);
  assert.equal(restarted.body, after.body);
  assert.equal(restarted.heading, after.heading);
  const selection = await fetch(`${origin}/api/admin/theme/selection`, {
    method: 'PATCH', headers: { Cookie: cookie, Origin: origin,
      'Content-Type': 'application/json' },
    body: JSON.stringify({ themeId: 'studio', templateId: 'classic' }),
  });
  assert.equal(selection.status, 200, await selection.text());
  const selectedCss = await (await fetch(`${origin}/theme.css`)).text();
  assert.ok(selectedCss.includes(`--preset-body-font: ${installedThemes.studio.typography.body};`));
  assert.ok(selectedCss.includes(`--preset-heading-font: ${installedThemes.studio.typography.heading};`));
  await context.close();
  passed = true;
} catch (error) {
  process.stderr.write(`THM-005: ${error.stack ?? error}\n`);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (server) {
    try { process.kill(-server.pid, 'SIGTERM'); } catch { /* already exited */ }
  }
  database?.close();
  if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabaseUrl;
  if (directory) rmSync(directory, { recursive: true, force: true });
  process.stdout.write(`sudus: THM-005: ${passed ? 'pass' : 'fail'}\n`);
}
