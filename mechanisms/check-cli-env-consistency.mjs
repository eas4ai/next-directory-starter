import { mkdtempSync, copyFileSync, symlinkSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';

const project = resolve('.');
const sandbox = mkdtempSync(join(tmpdir(), 'cli-env-consistency-'));

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

function run(script, args = [], overrides = {}) {
  const env = { ...process.env, ...overrides };
  delete env.DATABASE_URL;
  delete env.BILLING_ENCRYPTION_KEY;
  delete env.NODE_ENV;
  if (overrides.DATABASE_URL) env.DATABASE_URL = overrides.DATABASE_URL;
  if (overrides.NODE_ENV) env.NODE_ENV = overrides.NODE_ENV;
  const result = spawnSync('npm', ['run', script, ...(args.length ? ['--', ...args] : [])], {
    cwd: sandbox, env, encoding: 'utf8', timeout: 120_000,
  });
  expect(result.status === 0,
    `${script} failed in isolated fixture: ${(result.stderr || result.stdout || result.error?.message || '').slice(-1000)}`);
  return result.stdout;
}

function rowCount(file, table) {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try { return db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count; }
  finally { db.close(); }
}

function hasTable(file, table) {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try { return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)); }
  finally { db.close(); }
}

let passed = false;
try {
  for (const name of ['src', 'scripts', 'fixtures', 'node_modules']) {
    symlinkSync(join(project, name), join(sandbox, name), 'dir');
  }
  for (const name of ['package.json', 'tsconfig.json']) {
    copyFileSync(join(project, name), join(sandbox, name));
  }
  const customDb = join(sandbox, 'custom.db');
  const overrideDb = join(sandbox, 'override.db');
  const defaultDb = join(sandbox, '.runtime', 'directory.db');
  const key = randomBytes(32).toString('base64url');
  const keyFile = join(sandbox, 'billing.key');
  writeFileSync(keyFile, `${key}\n`, { mode: 0o600 });
  writeFileSync(join(sandbox, '.env.local'), [
    `DATABASE_URL=file:${customDb}`,
    `BILLING_ENCRYPTION_KEY=${key}`,
    `BETTER_AUTH_SECRET=${randomBytes(32).toString('base64url')}`,
    'BETTER_AUTH_URL=http://localhost:3000',
    'SITE_URL=http://localhost:3000',
    '',
  ].join('\n'));

  run('db:migrate');
  run('db:seed');
  expect(rowCount(customDb, '"user"') === 0, 'Authentication migration missed the custom database');
  expect(rowCount(customDb, 'listings') >= 2, 'Catalog migration or seed missed the custom database');
  expect(!existsSync(defaultDb), 'Migration or seed created the default database beside the custom one');

  run('notifications:deliver', ['--limit', '1']);
  run('billing:reconcile', ['--limit', '1']);
  expect(!existsSync(defaultDb), 'Maintenance command created the default database');
  const backup = join(sandbox, 'backup');
  const restored = join(sandbox, 'restored');
  expect(run('ops:backup', ['--output', backup, '--key-file', keyFile])
    .includes('Backup created and verified.'), 'Backup did not verify the custom database');
  expect(run('ops:restore', ['--backup', backup, '--target', restored])
    .includes('Isolated restore verified.'), 'Restore did not verify the custom database backup');
  expect(rowCount(join(restored, 'database.db'), 'listings') >= 2,
    'Restored backup does not contain the custom database listings');
  expect(!existsSync(defaultDb), 'Backup or restore created the default database');

  run('db:migrate', [], { DATABASE_URL: `file:${overrideDb}` });
  run('db:seed', [], { DATABASE_URL: `file:${overrideDb}` });
  expect(hasTable(overrideDb, 'user'), 'Explicit DATABASE_URL missed authentication migration');
  expect(rowCount(overrideDb, 'listings') >= 2, 'Explicit DATABASE_URL did not override .env.local');
  expect(!existsSync(defaultDb), 'Override run created the default database');

  const layeredDb = join(sandbox, 'production.db');
  writeFileSync(join(sandbox, '.env.production.local'), `DATABASE_URL=file:${layeredDb}\n`);
  run('db:migrate', [], { NODE_ENV: 'production' });
  run('db:seed', [], { NODE_ENV: 'production' });
  expect(hasTable(layeredDb, 'user'), 'Authentication migration missed the mode-specific database');
  expect(rowCount(layeredDb, 'listings') >= 2, 'Catalog migration or seed missed the mode-specific database');
  expect(!existsSync(defaultDb), 'Mode-specific run created the default database');

  const developmentDb = join(sandbox, 'development.db');
  writeFileSync(join(sandbox, '.env.development.local'), `DATABASE_URL=file:${developmentDb}\n`);
  run('db:migrate');
  run('db:seed');
  expect(hasTable(developmentDb, 'user'), 'Authentication migration missed the default development database');
  expect(rowCount(developmentDb, 'listings') >= 2, 'Catalog migration or seed missed the default development database');
  expect(!existsSync(defaultDb), 'Default development run created the default database');

  const manual = readFileSync(join(project, 'docs/operator-manual.md'), 'utf8');
  expect(manual.includes('.env.local') && manual.includes('DATABASE_URL') &&
    !manual.includes('a path only in `.env.local` can split their work across databases'),
    'Operator manual still describes the old split-database behavior');

  passed = true;
} catch (error) {
  process.stderr.write(`FOUND-006: ${error.message}\n`);
} finally {
  rmSync(sandbox, { recursive: true, force: true });
  process.stdout.write(`sudus: FOUND-006: ${passed ? 'pass' : 'fail'}\n`);
}
