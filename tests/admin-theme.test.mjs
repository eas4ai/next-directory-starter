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
  const port = await freePort();
  origin = `http://127.0.0.1:${port}`;
  app = spawn('npm', ['run', 'start', '--', '-p', String(port)], {
    env: { ...appEnv, SITE_URL: origin, NEXT_PUBLIC_SITE_URL: origin },
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
  const response = await request('/api/auth/sign-in', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(response.status, 200);
  const cookie = response.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
  assert.ok(cookie, 'sign-in must establish a session');
  return cookie;
}

const json = (body, cookie) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
  body: JSON.stringify(body),
});

before(async () => {
  workspace = mkdtempSync(join(tmpdir(), 'directory-theme-'));
  appEnv = {
    ...process.env,
    CI: '1',
    DATABASE_URL: `file:${join(workspace, 'directory.db')}`,
    AUTH_SECRET: randomBytes(32).toString('hex'),
  };
  command(['run', 'build']);
  command(['run', 'db:migrate']);
  command(['run', 'account:provision', '--', '--email', adminEmail, '--password', password, '--role', 'admin']);
  command(['run', 'account:provision', '--', '--email', memberEmail, '--password', password, '--role', 'member']);
  await startApp();
});

after(async () => {
  await stopApp();
  if (workspace) rmSync(workspace, { recursive: true, force: true });
});

test('ADM-004 only authenticated administrators can open or change the theme', async () => {
  const guestPage = await request('/admin/theme');
  const guestSave = await request('/api/admin/theme', json({ theme: 'blue' }));
  assert.ok([302, 303, 307, 308, 401, 403].includes(guestPage.status));
  assert.ok([401, 403].includes(guestSave.status));
  const member = await signIn(memberEmail);
  const memberPage = await request('/admin/theme', { headers: { Cookie: member } });
  const memberSave = await request('/api/admin/theme', json({ theme: 'blue' }, member));
  assert.equal(memberPage.status, 403);
  assert.equal(memberSave.status, 403);
  const admin = await signIn(adminEmail);
  assert.equal((await request('/admin/theme', { headers: { Cookie: admin } })).status, 200);
});

test('ADM-005 the editor exposes and previews every pinned shadcn preset choice', async () => {
  const admin = await signIn(adminEmail);
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
  assert.deepEqual(preview.preset, chosen);
  const save = await request('/api/admin/theme', json(chosen, admin));
  assert.equal(save.status, 200);
  const saved = await (await request('/api/admin/theme', { headers: { Cookie: admin } })).json();
  assert.deepEqual(saved.preset, chosen);
});

test('ADM-006 the saved theme reaches public and admin pages after restart', async () => {
  const admin = await signIn(adminEmail);
  const chosen = {
    style: 'vega', baseColor: 'stone', theme: 'blue', chartColor: 'blue',
    iconLibrary: 'lucide', font: 'geist', fontHeading: 'inherit',
    radius: 'large', menuAccent: 'bold', menuColor: 'inverted', mode: 'dark',
  };
  assert.equal((await request('/api/admin/theme', json(chosen, admin))).status, 200);
  await stopApp();
  await startApp();
  const publicPage = await (await request('/listings')).text();
  const adminAgain = await signIn(adminEmail);
  const adminPage = await (await request('/admin/theme', { headers: { Cookie: adminAgain } })).text();
  for (const html of [publicPage, adminPage]) {
    assert.match(html, /data-site-preset=["'][^"']+["']/);
    assert.match(html, /--primary:/);
    assert.match(html, /--radius:/);
  }
  const persisted = await (await request('/api/admin/theme', { headers: { Cookie: adminAgain } })).json();
  assert.deepEqual(persisted.preset, chosen);
});

test('ADM-007 first-admin provisioning works without public self-promotion', async () => {
  const admin = await signIn(adminEmail);
  const member = await signIn(memberEmail);
  const adminAccount = await (await request('/api/auth/me', { headers: { Cookie: admin } })).json();
  const memberAccount = await (await request('/api/auth/me', { headers: { Cookie: member } })).json();
  assert.equal(adminAccount.role, 'admin');
  assert.equal(memberAccount.role, 'member');
  const selfPromotion = await request('/api/auth/me', json({ role: 'admin' }, member));
  assert.ok([400, 403, 404, 405].includes(selfPromotion.status));
  const after = await (await request('/api/auth/me', { headers: { Cookie: member } })).json();
  assert.equal(after.role, 'member');
});
