import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';

const adminEmail = 'theme-admin@example.invalid';
const memberEmail = 'theme-member@example.invalid';
const password = randomBytes(20).toString('hex');
let workspace;
let origin;
let app;
let appEnv;
let adminCookie;
let memberCookie;

function command(args) {
  const done = spawnSync('npm', args, {
    env: appEnv,
    encoding: 'utf8',
    timeout: 120_000,
  });
  assert.equal(done.status, 0, `${args.join(' ')} failed: ${done.stderr}`);
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function startApp() {
  const port = new URL(origin).port;
  app = spawn('npm', ['run', 'start', '--', '-p', port], {
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
  assert.fail('The application did not start.');
}

async function stopApp() {
  if (!app) return;
  try { process.kill(-app.pid, 'SIGTERM'); } catch { /* already exited */ }
  app = null;
  await new Promise((resolve) => setTimeout(resolve, 300));
}

async function request(path, options = {}) {
  return fetch(new URL(path, origin), { redirect: 'manual', ...options });
}

async function signIn(email) {
  const response = await request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(response.status, 200);
  const cookie = response.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
  assert.ok(cookie, 'sign-in must establish a session');
  return cookie;
}

const json = (body, cookie) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: origin, ...(cookie ? { Cookie: cookie } : {}) },
  body: JSON.stringify(body),
});

before(async () => {
  workspace = mkdtempSync(join(tmpdir(), 'directory-theme-'));
  origin = `http://127.0.0.1:${await freePort()}`;
  appEnv = {
    ...process.env,
    CI: '1',
    DATABASE_URL: `file:${join(workspace, 'directory.db')}`,
    BETTER_AUTH_SECRET: randomBytes(32).toString('hex'),
    BETTER_AUTH_URL: origin,
  };
  command(['run', 'build']);
  command(['run', 'db:migrate']);
  command(['run', 'account:provision', '--', '--email', adminEmail, '--password', password, '--role', 'admin', '--yes']);
  await startApp();
  const member = await request('/api/auth/sign-up/email', json({ name: 'Member', email: memberEmail, password }));
  assert.equal(member.status, 200, await member.text());
  adminCookie = await signIn(adminEmail);
  memberCookie = await signIn(memberEmail);
});

after(async () => {
  await stopApp();
  if (workspace) rmSync(workspace, { recursive: true, force: true });
});

test('ADM-004 only authenticated administrators can open or change the theme', async () => {
  const { DEFAULT_PRESET_CONFIG } = await import('shadcn/preset');
  const initial = { ...DEFAULT_PRESET_CONFIG, theme: 'red', mode: 'system' };
  const unauthorized = { ...initial, theme: 'blue' };
  const admin = adminCookie;
  const initialSave = await request('/api/admin/theme', json(initial, admin));
  assert.equal(initialSave.status, 200);
  const guestPage = await request('/admin/theme');
  const guestSave = await request('/api/admin/theme', json(unauthorized));
  const guestOptions = await request('/api/admin/theme/options');
  const guestPreview = await request('/api/admin/theme/preview', json(unauthorized));
  assert.ok([302, 303, 307, 308, 401, 403].includes(guestPage.status));
  assert.equal(guestSave.status, 403);
  assert.equal(guestOptions.status, 403);
  assert.equal(guestPreview.status, 403);
  const member = memberCookie;
  const memberPage = await request('/admin/theme', { headers: { Cookie: member } });
  const memberSave = await request('/api/admin/theme', json(unauthorized, member));
  const memberOptions = await request('/api/admin/theme/options', { headers: { Cookie: member } });
  const memberPreview = await request('/api/admin/theme/preview', json(unauthorized, member));
  assert.equal(memberPage.status, 403);
  assert.equal(memberSave.status, 403);
  assert.equal(memberOptions.status, 403);
  assert.equal(memberPreview.status, 403);
  assert.equal((await request('/admin/theme', { headers: { Cookie: admin } })).status, 200);
  const saved = await (await request('/api/admin/theme', { headers: { Cookie: admin } })).json();
  assert.deepEqual(saved.preset, initial);
});

test('ADM-005 the editor exposes and previews every pinned shadcn preset choice', async () => {
  const admin = adminCookie;
  const { PRESET_STYLES, PRESET_BASE_COLORS, PRESET_THEMES,
    PRESET_CHART_COLORS, PRESET_ICON_LIBRARIES, PRESET_FONTS,
    PRESET_FONT_HEADINGS, PRESET_RADII, PRESET_MENU_ACCENTS,
    PRESET_MENU_COLORS } = await import('shadcn/preset');
  const expected = {
    style: PRESET_STYLES, baseColor: PRESET_BASE_COLORS,
    theme: PRESET_THEMES, chartColor: PRESET_CHART_COLORS,
    iconLibrary: PRESET_ICON_LIBRARIES, font: PRESET_FONTS,
    fontHeading: PRESET_FONT_HEADINGS, radius: PRESET_RADII,
    menuAccent: PRESET_MENU_ACCENTS, menuColor: PRESET_MENU_COLORS,
    mode: ['light', 'dark', 'system'],
  };
  const optionsResponse = await request('/api/admin/theme/options', { headers: { Cookie: admin } });
  assert.equal(optionsResponse.status, 200);
  const options = await optionsResponse.json();
  const names = (values) => values.map((item) => typeof item === 'string' ? item : item.value ?? item.name);
  for (const [field, choices] of Object.entries(expected)) {
    assert.deepEqual(new Set(names(options[field])), new Set(names(choices)), field);
  }
  const page = await (await request('/admin/theme', { headers: { Cookie: admin } })).text();
  for (const field of Object.keys(expected)) {
    assert.match(page, new RegExp(`name=["']${field}["']`), `${field} control is absent`);
  }
  const chosen = Object.fromEntries(Object.entries(expected).map(([key, values]) =>
    [key, names(values).at(-1)]));
  const previewResponse = await request('/api/admin/theme/preview', json(chosen, admin));
  assert.equal(previewResponse.status, 200);
  const preview = await previewResponse.json();
  assert.ok(preview.css && preview.css.includes('--primary'));
  assert.match(preview.css, /--preset-body-font:/);
  assert.match(preview.css, /--preset-icon-library:/);
  assert.deepEqual(preview.preset, chosen);
  const alternate = await (await request('/api/admin/theme/preview', json({ ...chosen, theme: 'blue' }, admin))).json();
  assert.notEqual(alternate.css, preview.css);
  const invalid = await request('/api/admin/theme', json({ ...chosen, style: 'unknown-style' }, admin));
  assert.equal(invalid.status, 400);
  const save = await request('/api/admin/theme', json(chosen, admin));
  assert.equal(save.status, 200);
  const saved = await (await request('/api/admin/theme', { headers: { Cookie: admin } })).json();
  assert.deepEqual(saved.preset, chosen);
});

test('ADM-006 the saved theme reaches public and admin pages after restart', async () => {
  const admin = adminCookie;
  const chosen = {
    style: 'vega', baseColor: 'stone', theme: 'blue', chartColor: 'blue',
    iconLibrary: 'remixicon', font: 'lora', fontHeading: 'playfair-display',
    radius: 'large', menuAccent: 'bold', menuColor: 'default-translucent', mode: 'dark',
  };
  assert.equal((await request('/api/admin/theme', json(chosen, admin))).status, 200);
  await stopApp();
  await startApp();
  const publicPage = await (await request('/listings')).text();
  const adminAgain = adminCookie;
  const adminPage = await (await request('/admin/theme', { headers: { Cookie: adminAgain } })).text();
  for (const html of [publicPage, adminPage]) {
    assert.equal(html.match(/data-site-preset="([^"]+)"/)?.[1], Object.values(chosen).join('.'));
    assert.match(html, /data-mode="dark"/);
    assert.match(html, /data-icon-library="remixicon"/);
    assert.match(html, /--primary: oklch\([^)]*264\)/);
    assert.match(html, /--radius: 0\.875rem/);
    assert.match(html, /--preset-body-font: "Lora"/);
    assert.match(html, /--preset-heading-font: "Playfair Display"/);
    const sidebarColor = html.match(/--sidebar: ([^;]+)/)?.[1] ?? '';
    assert.match(sidebarColor, /^oklch\([^)]* \/ 0\.85\)$/);
    assert.match(html.match(/<header\b[^>]*>/)?.[0] ?? '', /background:var\(--sidebar\)/);
  }
  const persisted = await (await request('/api/admin/theme', { headers: { Cookie: adminAgain } })).json();
  assert.deepEqual(persisted.preset, chosen);
});

test('ADM-007 first-admin provisioning works without public self-promotion', async () => {
  const signInPage = await request('/admin/sign-in');
  assert.equal(signInPage.status, 200);
  const signInHtml = await signInPage.text();
  assert.match(signInHtml, /Administrator sign in/);
  assert.match(signInHtml, /name="email"/);
  assert.match(signInHtml, /name="password"/);
  const admin = adminCookie;
  const member = memberCookie;
  const adminAccount = await (await request('/api/auth/get-session', { headers: { Cookie: admin } })).json();
  const memberAccount = await (await request('/api/auth/get-session', { headers: { Cookie: member } })).json();
  assert.equal(adminAccount.user.role, 'admin');
  assert.equal(memberAccount.user.role, 'user');
  const selfPromotion = await request('/api/auth/admin/set-role', json({ userId: memberAccount.user.id, role: 'admin' }, member));
  assert.ok([400, 403, 404, 405].includes(selfPromotion.status));
  const after = await (await request('/api/auth/get-session', { headers: { Cookie: member } })).json();
  assert.equal(after.user.role, 'user');
});
