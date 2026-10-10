import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync,
  symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { chromium } from 'playwright-core';

const requirements = ['ADM-008', 'ADM-009', 'UI-001', 'FOUND-005', 'OPS-001', 'OPS-002'];
const results = Object.fromEntries(requirements.map((id) => [id, false]));
const workspace = mkdtempSync(join(tmpdir(), 'directory-adoption-check-'));
const databaseFile = join(workspace, 'directory.db');
const mediaDir = join(workspace, 'media');
const keyFile = join(workspace, 'billing.key');
let env;
let origin;
let app;
let adminCookie;
let ownerCookie;
let browser;

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function command(args, options = {}) {
  const result = spawnSync('npm', args, {
    env: options.env ?? env, encoding: 'utf8', timeout: 180_000,
  });
  if (result.status !== 0) {
    throw new Error(`npm command failed: ${result.stderr || result.stdout || result.signal || result.status}`);
  }
  return result.stdout;
}

async function start() {
  app = spawn('npm', ['run', 'start', '--', '-p', new URL(origin).port],
    { env, detached: true, stdio: 'ignore' });
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (app.exitCode !== null) break;
    try { if ((await fetch(origin, { signal: AbortSignal.timeout(1000) })).status < 500) return; }
    catch { /* startup */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Production server did not start');
}

const request = (path, options = {}) => fetch(new URL(path, origin), { redirect: 'manual', ...options });
const json = (body, cookie, method = 'POST') => ({ method, body: JSON.stringify(body),
  headers: { Origin: origin, 'Content-Type': 'application/json',
    ...(cookie ? { Cookie: cookie } : {}) } });

async function signIn(email, password) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await request('/api/auth/sign-in/email', json({ email, password }));
    if (response.status === 429) {
      await new Promise((resolve) => setTimeout(resolve, 2_500));
      continue;
    }
    if (!response.ok) throw new Error(`${email} sign-in returned ${response.status}`);
    const cookie = response.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
    if (!cookie) throw new Error(`${email} sign-in returned no session`);
    return cookie;
  }
  throw new Error(`${email} sign-in remained rate limited`);
}

async function chrome() {
  browser ??= await chromium.launch({ headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
    args: ['--no-sandbox'] });
  return browser;
}

async function appearanceMetrics(page) {
  return page.evaluate(() => {
    const style = getComputedStyle(document.body);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const painter = canvas.getContext('2d');
    const rgb = (color) => {
      painter.clearRect(0, 0, 1, 1);
      painter.fillStyle = color;
      painter.fillRect(0, 0, 1, 1);
      return [...painter.getImageData(0, 0, 1, 1).data].slice(0, 3);
    };
    const luminance = (color) => rgb(color).map((value) => {
      const channel = value / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    }).reduce((total, value, index) => total + value * [0.2126, 0.7152, 0.0722][index], 0);
    const contrast = (foreground, background) => {
      const levels = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
      return (levels[0] + 0.05) / (levels[1] + 0.05);
    };
    return {
      mode: document.documentElement.dataset.mode,
      preset: document.documentElement.dataset.sitePreset,
      background: style.backgroundColor,
      contrast: contrast(style.color, style.backgroundColor),
      scrollWidth: document.documentElement.scrollWidth,
    };
  });
}

async function check(id, run) {
  try { await run(); results[id] = true; }
  catch (error) { process.stderr.write(`${id}: ${error.message}\n`); }
}

try {
  origin = `http://127.0.0.1:${await freePort()}`;
  mkdirSync(mediaDir);
  writeFileSync(join(mediaDir, 'backup-evidence.txt'), 'approved media evidence');
  const billingKey = randomBytes(32).toString('base64url');
  writeFileSync(keyFile, billingKey, { mode: 0o600 });
  env = { ...process.env, CI: '1', DATABASE_URL: `file:${databaseFile}`,
    MEDIA_DIR: mediaDir, BILLING_ENCRYPTION_KEY: billingKey,
    BETTER_AUTH_SECRET: randomBytes(32).toString('hex'),
    BETTER_AUTH_URL: origin, SITE_URL: origin };

  await check('FOUND-005', () => {
    const license = readFileSync('LICENSE', 'utf8');
    const notice = readFileSync('NOTICE.md', 'utf8');
    if (!license.includes('MIT License') ||
        !license.includes('Copyright (c) 2026 Shawn McAllister') ||
        !license.includes('Permission is hereby granted, free of charge') ||
        !notice.includes('shadcn/ui') ||
        JSON.parse(readFileSync('package.json', 'utf8')).license !== 'MIT') {
      throw new Error('MIT distribution grant or source notices are absent');
    }
    for (const path of ['src/app/page.tsx', 'fixtures/sample-listings.json']) {
      if (/devlist\.app|DevList production/i.test(readFileSync(path, 'utf8'))) {
        throw new Error(`Reference branding or production data entered ${path}`);
      }
    }
  });

  command(['run', 'db:migrate']);
  command(['run', 'db:seed']);
  const password = randomBytes(20).toString('hex');
  for (const [email, role] of [
    ['adoption-admin@example.invalid', 'admin'],
    ['adoption-owner@example.invalid', 'user'],
    ['adoption-moderator@example.invalid', 'user'],
    ['adoption-editor@example.invalid', 'user'],
    ['adoption-catalog@example.invalid', 'user'],
    ['adoption-taxonomy@example.invalid', 'user'],
    ['adoption-billing@example.invalid', 'user'],
  ]) {
    command(['run', 'account:provision', '--', '--email', email,
      '--password', password, '--role', role, '--yes']);
  }
  command(['run', 'account:provision', '--', '--email', 'adoption-unverified@example.invalid',
    '--password', password, '--role', 'user', '--no-email-verified', '--yes']);
  command(['run', 'build']);
  await start();
  adminCookie = await signIn('adoption-admin@example.invalid', password);
  ownerCookie = await signIn('adoption-owner@example.invalid', password);

  const draft = await request('/api/owner/listings', json({ slug: 'adoption-pending',
    name: 'Pending adoption listing', summary: 'A listing awaiting review',
    description: 'A private draft for the overview count.', category: 'Tools',
    url: 'https://example.org/adoption-pending' }, ownerCookie));
  if (draft.status !== 201) throw new Error(`Owner fixture returned ${draft.status}`);
  const submitted = await request('/api/owner/listings/adoption-pending/submit', json({}, ownerCookie));
  if (!submitted.ok) throw new Error(`Review fixture returned ${submitted.status}`);
  const initialSubmissionId = (await submitted.json()).submission?.id;
  if (!initialSubmissionId) throw new Error('Review fixture had no identifier');

  function accountId(email) {
    const db = new Database(databaseFile, { readonly: true });
    const row = db.prepare('SELECT id FROM "user" WHERE email = ?').get(email);
    db.close();
    if (!row?.id) throw new Error(`Account fixture is absent: ${email}`);
    return row.id;
  }

  await check('ADM-008', async () => {
    const guest = await request('/api/admin/overview');
    if (![401, 403, 404].includes(guest.status)) throw new Error('Guest read staff overview');
    const ordinary = await request('/api/admin/overview', { headers: { Cookie: ownerCookie } });
    if (![401, 403, 404].includes(ordinary.status)) throw new Error('Ordinary account read staff overview');
    for (let n = 0; n < 6; n += 1) {
      const saved = await request('/api/admin/seo/redirects', json({
        source: `/overview-old-${n}`, destination: '/listings/example-tool',
      }, adminCookie));
      if (!saved.ok) throw new Error(`Audit fixture ${n} could not be saved`);
    }
    const response = await request('/api/admin/overview', { headers: { Cookie: adminCookie } });
    if (!response.ok) throw new Error(`Staff overview returned ${response.status}`);
    const value = await response.json();
    if (value.publicListings !== 1 || value.publishedArticles !== 0 ||
        value.pendingSubmissions !== 1 || !Array.isArray(value.recentActivity) ||
        value.recentActivity.length !== 5) {
      throw new Error('Overview counts or bounded audit did not match the current database');
    }
    const page = await request('/admin/overview', { headers: { Cookie: adminCookie } });
    const html = await page.text();
    if (!page.ok || !html.includes('Published listings') || !html.includes('/admin/review')) {
      throw new Error('Overview did not link the real review work');
    }
    const created = await request('/api/admin/listings', json({ slug: 'overview-extra',
      name: 'Overview extra', summary: 'Published count fixture', description: 'Count fixture',
      category: 'Tools', url: 'https://example.org/overview-extra', status: 'published',
    }, adminCookie));
    if (created.status !== 201) throw new Error('Published count fixture could not be created');
    const withExtra = await (await request('/api/admin/overview',
      { headers: { Cookie: adminCookie } })).json();
    const suspended = await request('/api/admin/listings/overview-extra/suspend',
      json({ reason: 'Overview eligibility check' }, adminCookie));
    const afterSuspension = await (await request('/api/admin/overview',
      { headers: { Cookie: adminCookie } })).json();
    if (withExtra.publicListings !== 2 || !suspended.ok || afterSuspension.publicListings !== 1) {
      throw new Error('Overview publication count ignored an eligibility change');
    }
    const approved = await request(`/api/admin/submissions/${initialSubmissionId}/decision`,
      json({ decision: 'approve', reason: 'Overview revision check' }, adminCookie));
    const changed = await request('/api/owner/listings/adoption-pending',
      json({ summary: 'A proposed summary awaiting approval' }, ownerCookie, 'PATCH'));
    const resubmitted = await request('/api/owner/listings/adoption-pending/submit',
      json({}, ownerCookie));
    const revisionOverview = await (await request('/api/admin/overview',
      { headers: { Cookie: adminCookie } })).json();
    if (!approved.ok || !changed.ok || !resubmitted.ok ||
        revisionOverview.publicListings !== 2 || revisionOverview.pendingSubmissions !== 1) {
      throw new Error('Overview missed a pending revision on a public listing');
    }
    const context = await (await chrome()).newContext({ viewport: { width: 320, height: 740 } });
    try {
      await context.addCookies(adminCookie.split('; ').map((pair) => {
        const divider = pair.indexOf('=');
        return { name: pair.slice(0, divider), value: pair.slice(divider + 1), url: origin };
      }));
      const browserPage = await context.newPage();
      await browserPage.goto(`${origin}/admin/overview`, { waitUntil: 'domcontentloaded' });
      const scrollWidth = await browserPage.evaluate(() => document.documentElement.scrollWidth);
      if (scrollWidth > 320) throw new Error('Overview overflows at 320 pixels');
      const reviewLink = browserPage.locator('a[href="/admin/review"]').first();
      await reviewLink.focus();
      if (!(await reviewLink.evaluate((element) => element === document.activeElement))) {
        throw new Error('Review work link cannot receive keyboard focus');
      }
      await browserPage.keyboard.press('Enter');
      await browserPage.waitForURL('**/admin/review');
    } finally { await context.close(); }
    const focused = spawnSync('node', ['--import', 'tsx', '--test',
      'tests/operator-overview.test.mjs'], { env, encoding: 'utf8', timeout: 30_000 });
    if (focused.status !== 0) {
      throw new Error(`Overview empty and error states failed: ${focused.stderr || focused.stdout}`);
    }
  });

  await check('ADM-009', async () => {
    const ownerId = accountId('adoption-owner@example.invalid');
    const changed = await request(`/api/admin/accounts/${ownerId}/role`,
      json({ role: 'catalog,billing' }, adminCookie, 'PATCH'));
    if (!changed.ok) throw new Error(`Combined staff capabilities returned ${changed.status}`);
    const catalog = await request('/api/admin/listings', { headers: { Cookie: ownerCookie } });
    const plans = await request('/api/admin/plans', { headers: { Cookie: ownerCookie } });
    const theme = await request('/api/admin/theme', { headers: { Cookie: ownerCookie } });
    const seo = await request('/api/admin/seo/settings', { headers: { Cookie: ownerCookie } });
    const audit = await request('/api/admin/audit', { headers: { Cookie: ownerCookie } });
    const review = await request('/api/admin/submissions', { headers: { Cookie: ownerCookie } });
    if (!catalog.ok || !plans.ok || ![401, 403, 404].includes(theme.status) ||
        ![401, 403, 404].includes(review.status) || ![401, 403, 404].includes(seo.status) ||
        ![401, 403, 404].includes(audit.status)) {
      throw new Error('Combined capabilities crossed a protected boundary');
    }
    const roles = [
      ['moderator', '/api/admin/submissions', '/api/admin/articles'],
      ['editor', '/api/admin/articles', '/api/admin/submissions'],
      ['catalog', '/api/admin/listings', '/api/admin/plans'],
      ['taxonomy', '/api/admin/categories', '/api/admin/plans'],
      ['billing', '/api/admin/plans', '/api/admin/listings'],
    ];
      const plan = (key) => ({ key, name: 'Forbidden plan probe', description: '',
        mode: 'test', billingMode: 'one-time', amountMinor: 1200, currency: 'usd',
        durationDays: 30, featured: false, enabled: false });
      const forbiddenWrites = {
        moderator: { path: '/api/admin/articles',
          body: { slug: 'forbidden-moderator-article', title: 'Forbidden article',
            summary: 'Permission boundary probe', body: 'No editor permission',
            status: 'draft', tags: [] },
          query: 'SELECT 1 FROM articles WHERE slug = ?', key: 'forbidden-moderator-article' },
        editor: { path: '/api/admin/plans', body: plan('forbidden-editor-plan'),
          query: 'SELECT 1 FROM publishing_plans WHERE key = ?', key: 'forbidden-editor-plan' },
        catalog: { path: '/api/admin/categories', body: { name: 'Forbidden catalog category' },
          query: 'SELECT 1 FROM categories WHERE name = ?', key: 'Forbidden catalog category' },
        taxonomy: { path: '/api/admin/plans', body: plan('forbidden-taxonomy-plan'),
          query: 'SELECT 1 FROM publishing_plans WHERE key = ?', key: 'forbidden-taxonomy-plan' },
        billing: { path: '/api/admin/listings',
          body: { slug: 'forbidden-billing-listing', name: 'Forbidden listing',
            summary: 'Permission boundary probe', description: 'No catalog permission',
            category: 'Tools', url: 'https://example.org/forbidden-billing', status: 'draft' },
          query: 'SELECT 1 FROM listings WHERE slug = ?', key: 'forbidden-billing-listing' },
      };
    for (const [role, permitted, forbidden] of roles) {
      const email = `adoption-${role}@example.invalid`;
      const id = accountId(email);
      const assigned = await request(`/api/admin/accounts/${id}/role`,
        json({ role }, adminCookie, 'PATCH'));
      if (!assigned.ok) throw new Error(`${role} capability could not be assigned`);
      const cookie = await signIn(email, password);
      const allowed = await request(permitted, { headers: { Cookie: cookie } });
      const denied = await request(forbidden, { headers: { Cookie: cookie } });
      if (!allowed.ok || ![401, 403, 404].includes(denied.status)) {
        throw new Error(`${role} capability was missing or crossed into another area`);
      }
        const probe = forbiddenWrites[role];
        const write = await request(probe.path, json(probe.body, cookie));
        const guard = new Database(databaseFile, { readonly: true });
        const changed = guard.prepare(probe.query).get(probe.key);
        guard.close();
        if (![401, 403, 404].includes(write.status) || changed) {
          throw new Error(`${role} capability wrote to a forbidden area`);
        }
    }
    const selfDemotion = await request(`/api/admin/accounts/${accountId('adoption-admin@example.invalid')}/role`,
      json({ role: 'user' }, adminCookie, 'PATCH'));
    if (selfDemotion.status !== 409) throw new Error('The final administrator could be demoted');
    const unverified = await request(`/api/admin/accounts/${accountId('adoption-unverified@example.invalid')}/role`,
      json({ role: 'moderator' }, adminCookie, 'PATCH'));
    if (![400, 403, 409].includes(unverified.status)) {
      throw new Error('An unverified account received a staff capability');
    }
    const roleAudit = new Database(databaseFile, { readonly: true });
    const accountRoleEvent = roleAudit.prepare(`SELECT 1 FROM audit_events
      WHERE action = 'account.role' AND target = ?`).get(ownerId);
    roleAudit.close();
    if (!accountRoleEvent) throw new Error('Delegated role change lacked audit history');
    const overview = await request('/admin/overview', { headers: { Cookie: ownerCookie } });
    const overviewHtml = await overview.text();
    if (!overview.ok || !overviewHtml.includes('/admin/catalog') ||
        !overviewHtml.includes('/admin/plans') || overviewHtml.includes('/admin/theme')) {
      throw new Error('Staff navigation differed from direct permissions');
    }
    const scopedOverview = await request('/api/admin/overview',
      { headers: { Cookie: ownerCookie } });
    const scoped = scopedOverview.ok ? await scopedOverview.json() : null;
    if (!scopedOverview.ok || (Array.isArray(scoped.recentActivity) && scoped.recentActivity.length)) {
      throw new Error('Delegated staff overview exposed protected audit details');
    }
    const suspended = await request(`/api/admin/accounts/${ownerId}/suspension`,
      json({ suspended: true, reason: 'Delegated access revocation check' }, adminCookie, 'PATCH'));
    const formerAccess = await request('/api/admin/listings', { headers: { Cookie: ownerCookie } });
    if (!suspended.ok || ![401, 403, 404].includes(formerAccess.status)) {
      throw new Error('Suspension retained delegated access on an existing session');
    }
  });

  await check('UI-001', async () => {
    const dark = await (await request('/', { headers: { Cookie: 'site_appearance=dark' } })).text();
    const light = await (await request('/', { headers: { Cookie: 'site_appearance=light' } })).text();
    const invalid = await (await request('/', { headers: { Cookie: 'site_appearance=invalid' } })).text();
    const darkPreset = /data-site-preset="([^"]+)"/.exec(dark)?.[1];
    const lightPreset = /data-site-preset="([^"]+)"/.exec(light)?.[1];
    if (!dark.includes('data-mode="dark"') || !light.includes('data-mode="light"') ||
        !invalid.includes('data-mode="system"') ||
        !dark.includes('aria-label="Appearance"') || !darkPreset || darkPreset !== lightPreset) {
      throw new Error('Initial HTML ignored a visitor choice or omitted the switch');
    }
    const chromiumBrowser = await chrome();
    const context = await chromiumBrowser.newContext({ viewport: { width: 320, height: 740 },
      colorScheme: 'light' });
    const other = await chromiumBrowser.newContext({ viewport: { width: 320, height: 740 },
      colorScheme: 'light' });
    try {
      await context.addCookies([{ name: 'site_appearance', value: 'dark', url: origin }]);
      await other.addCookies([{ name: 'site_appearance', value: 'dark', url: origin }]);
      const page = await context.newPage();
      const otherPage = await other.newPage();
      await page.goto(origin, { waitUntil: 'domcontentloaded' });
      await otherPage.goto(origin, { waitUntil: 'domcontentloaded' });
      const initial = await appearanceMetrics(page);
      const toggle = page.getByRole('button', { name: 'Appearance' });
      await toggle.focus();
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.documentElement.dataset.mode === 'light');
      const after = await appearanceMetrics(page);
      await page.reload({ waitUntil: 'domcontentloaded' });
      const persisted = await page.locator('html').getAttribute('data-mode');
      const otherMode = await otherPage.locator('html').getAttribute('data-mode');
      if (initial.mode !== 'dark' || persisted !== 'light' || otherMode !== 'dark' ||
          initial.background === after.background || initial.scrollWidth > 320 ||
          after.scrollWidth > 320 || initial.contrast < 4.5 || after.contrast < 4.5 ||
          initial.preset !== after.preset) {
        throw new Error('Appearance did not persist, stay private, or remain readable at 320 pixels');
      }
      for (const path of ['/listings', '/articles']) {
        await page.goto(`${origin}${path}`, { waitUntil: 'domcontentloaded' });
        await otherPage.goto(`${origin}${path}`, { waitUntil: 'domcontentloaded' });
        const lightPage = await appearanceMetrics(page);
        const darkPage = await appearanceMetrics(otherPage);
        if (lightPage.mode !== 'light' || darkPage.mode !== 'dark' ||
            lightPage.scrollWidth > 320 || darkPage.scrollWidth > 320 ||
            lightPage.contrast < 4.5 || darkPage.contrast < 4.5) {
          throw new Error(`${path} lost a visitor appearance or readability at 320 pixels`);
        }
      }
    } finally { await context.close(); await other.close(); }
      const systemContext = await chromiumBrowser.newContext({ viewport: { width: 320, height: 740 },
        colorScheme: 'dark' });
      try {
        const systemPage = await systemContext.newPage();
        await systemPage.goto(origin, { waitUntil: 'domcontentloaded' });
        const switchButton = systemPage.getByRole('button', { name: 'Appearance' });
        await systemPage.waitForFunction(() => document.querySelector(
          'button[aria-label="Appearance"]')?.getAttribute('title') === 'Switch to light appearance');
        if (await systemPage.locator('html').getAttribute('data-mode') !== 'system' ||
            await switchButton.getAttribute('aria-pressed') !== 'true' ||
            (await switchButton.textContent())?.trim() !== 'Dark') {
          throw new Error('System mode did not report the dark OS appearance');
        }
        await switchButton.focus();
        await systemPage.keyboard.press('Enter');
        await systemPage.waitForFunction(() => document.documentElement.dataset.mode === 'light');
        if (await switchButton.getAttribute('title') !== 'Switch to dark appearance' ||
            await switchButton.getAttribute('aria-pressed') !== 'false') {
          throw new Error('System appearance switch reported the wrong next action');
        }
        await systemPage.reload({ waitUntil: 'domcontentloaded' });
        if (await systemPage.locator('html').getAttribute('data-mode') !== 'light') {
          throw new Error('System appearance choice did not persist');
        }
      } finally { await systemContext.close(); }
  });

  await check('OPS-001', async () => {
    const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts;
    if (!scripts['ops:backup'] || !scripts['ops:restore']) {
      throw new Error('Repeatable backup and restore commands are absent');
    }
    const recoverySecret = `test-recovery-${randomBytes(12).toString('hex')}`;
    const profile = await request('/api/admin/billing/profiles', json({
      provider: 'nowpayments', mode: 'test', version: 0, enabled: false,
      apiKey: recoverySecret, webhookSecret: 'test-webhook-secret',
    }, adminCookie, 'PUT'));
    if (!profile.ok) throw new Error(`Encrypted profile fixture returned ${profile.status}`);
    const backup = join(workspace, 'backup');
    const restore = join(workspace, 'restored');
    command(['run', 'ops:backup', '--', '--output', backup, '--key-file', keyFile]);
    if (!existsSync(join(backup, 'database.db')) ||
        readFileSync(join(backup, 'media', 'backup-evidence.txt'), 'utf8') !== 'approved media evidence') {
      throw new Error('Backup omitted database or approved media');
    }
    const archived = new Database(join(backup, 'database.db'), { readonly: true });
    const cipher = archived.prepare(`SELECT api_key_cipher FROM billing_profiles
      WHERE provider = 'nowpayments' AND mode = 'test'`).get();
    archived.close();
    if (!cipher?.api_key_cipher || String(cipher.api_key_cipher).includes(recoverySecret)) {
      throw new Error('Backup exposed a billing secret or lost its encrypted profile');
    }
    command(['run', 'ops:restore', '--', '--backup', backup, '--target', restore]);
    const restored = new Database(join(restore, 'database.db'), { readonly: true });
    const listing = restored.prepare('SELECT name FROM listings WHERE slug = ?').get('example-tool');
    restored.close();
    if (listing?.name !== 'Example Tool' ||
        readFileSync(join(restore, 'media', 'backup-evidence.txt'), 'utf8') !== 'approved media evidence' ||
        readFileSync(join(restore, 'billing.key'), 'utf8') !== billingKey ||
        !existsSync(databaseFile)) {
      throw new Error('Isolated restore lost content, media, key, or source installation');
    }
    const probe = spawnSync('./node_modules/.bin/tsx', ['-e',
      `import { providerRecoveryConfiguration } from './src/lib/billing-profiles.ts';
       const value = providerRecoveryConfiguration('nowpayments', 'test');
       if (value?.apiKey !== process.env.EXPECTED_RECOVERY_SECRET) process.exit(1);`],
    { env: { ...env, DATABASE_URL: `file:${join(restore, 'database.db')}`,
      MEDIA_DIR: join(restore, 'media'),
      BILLING_ENCRYPTION_KEY: readFileSync(join(restore, 'billing.key'), 'utf8'),
      EXPECTED_RECOVERY_SECRET: recoverySecret }, encoding: 'utf8', timeout: 30_000 });
    if (probe.status !== 0) throw new Error(`Restored billing key could not decrypt saved settings: ${probe.stderr.replaceAll(recoverySecret, '[redacted]').slice(0, 800)}`);
    const repeat = spawnSync('npm', ['run', 'ops:restore', '--', '--backup', backup, '--target', restore],
      { env, encoding: 'utf8', timeout: 30_000 });
    if (repeat.status === 0 || !existsSync(join(restore, 'database.db'))) {
      throw new Error('Restore overwrote an existing target');
    }
    const wrongKey = join(workspace, 'wrong-billing.key');
    writeFileSync(wrongKey, randomBytes(32).toString('base64url'), { mode: 0o600 });
    const mismatched = spawnSync('npm', ['run', 'ops:backup', '--',
      '--output', join(workspace, 'wrong-key-backup'), '--key-file', wrongKey],
    { env, encoding: 'utf8', timeout: 30_000 });
    if (mismatched.status === 0) throw new Error('Backup accepted a mismatched billing key');
    const damaged = join(workspace, 'damaged-backup');
    cpSync(backup, damaged, { recursive: true });
    rmSync(join(damaged, 'media', 'backup-evidence.txt'));
    const rejected = spawnSync('npm', ['run', 'ops:restore', '--', '--backup', damaged,
      '--target', join(workspace, 'damaged-restore')],
    { env, encoding: 'utf8', timeout: 30_000 });
    if (rejected.status === 0 || existsSync(join(workspace, 'damaged-restore'))) {
      throw new Error('Restore accepted missing media');
    }
    const nestedTarget = join(mediaDir, 'restore-inside-live-media');
    const nested = spawnSync('npm', ['run', 'ops:restore', '--', '--backup', backup,
      '--target', nestedTarget], { env, encoding: 'utf8', timeout: 30_000 });
    if (nested.status === 0 || existsSync(nestedTarget)) {
      throw new Error('Restore wrote inside live media storage');
    }
    const alias = join(workspace, 'media-alias');
    symlinkSync(mediaDir, alias, 'dir');
    const linkedTarget = join(alias, 'restore-through-link');
    const linked = spawnSync('npm', ['run', 'ops:restore', '--', '--backup', backup,
      '--target', linkedTarget], { env, encoding: 'utf8', timeout: 30_000 });
    if (linked.status === 0 || existsSync(linkedTarget)) {
      throw new Error('Restore wrote inside live media storage through a symlink');
    }
  });

  await check('OPS-002', () => {
    const guide = readFileSync('UPGRADE.md', 'utf8');
    const nextVersion = JSON.parse(readFileSync('package.json', 'utf8')).dependencies.next;
    for (const phrase of ['npm ci', 'npm run build', 'npm run db:migrate',
      'ops:backup', 'ops:restore', 'BILLING_ENCRYPTION_KEY', 'MEDIA_DIR',
      'rollback', 'Do not reseed', nextVersion.replace(/^[^\d]*/, '')]) {
      if (!guide.includes(phrase)) throw new Error(`Upgrade guide omits ${phrase}`);
    }
    const shellBlocks = [...guide.matchAll(/```(?:sh|bash)\n([\s\S]*?)```/g)];
    if (!shellBlocks.length) throw new Error('Upgrade guide lacks executable shell examples');
    for (const [, shell] of shellBlocks) {
      const syntax = spawnSync('bash', ['-n'], { input: shell, encoding: 'utf8' });
      if (syntax.status !== 0) throw new Error('An upgrade shell example has invalid syntax');
    }
    command(['run', 'db:migrate']);
    const db = new Database(databaseFile, { readonly: true });
    const listing = db.prepare('SELECT name FROM listings WHERE slug = ?').get('example-tool');
    db.close();
    if (listing?.name !== 'Example Tool') throw new Error('Migration changed existing content');
  });
} catch (error) {
  process.stderr.write(`Adoption setup: ${error.message}\n`);
} finally {
  if (browser) await browser.close();
  if (app) { try { process.kill(-app.pid, 'SIGTERM'); } catch { /* stopped */ } }
  await new Promise((resolve) => setTimeout(resolve, 250));
  rmSync(workspace, { recursive: true, force: true });
  for (const id of requirements) {
    process.stdout.write(`sudus: ${id}: ${results[id] ? 'pass' : 'fail'}\n`);
  }
}
