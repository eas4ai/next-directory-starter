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

function execute(command, args, overrides = {}) {
  const env = { ...process.env };
  delete env.DATABASE_URL;
  delete env.BILLING_ENCRYPTION_KEY;
  delete env.NODE_ENV;
  Object.assign(env, overrides);
  return spawnSync(command, args, {
    cwd: sandbox, env, encoding: 'utf8', timeout: 120_000,
  });
}

function run(script, args = [], overrides = {}) {
  const result = execute('npm', ['run', script, ...(args.length ? ['--', ...args] : [])], overrides);
  expect(result.status === 0,
    `${script} failed in isolated fixture: ${(result.stderr || result.stdout || result.error?.message || '').slice(-1000)}`);
  return result.stdout;
}

function reject(label, command, args, url) {
  const result = execute(command, args, { DATABASE_URL: url });
  const output = result.stderr || result.stdout || result.error?.message || '';
  expect(result.status !== 0 && output.includes('DATABASE_URL'),
    `${label} accepted ${url}: ${output.slice(-1000)}`);
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

  for (const path of ['src/lib/database.ts', 'src/lib/media.ts',
    'scripts/ops-common.mjs', 'scripts/healthcheck.mjs']) {
    expect(readFileSync(join(project, path), 'utf8').includes('parseDatabaseUrl'),
      `${path} does not use the shared DATABASE_URL parser`);
  }

  const malformedDatabase = join(sandbox, 'malformed.db');
  for (const [name, url] of [
    ['empty', 'file:'],
    ['query-bearing', `file:${malformedDatabase}?mode=ro`],
  ]) {
    const malformedBackup = join(sandbox, `malformed-${name}-backup`);
    const malformedRestore = join(sandbox, `malformed-${name}-restore`);
    const commands = [
      ['application runtime', process.execPath,
        ['--import', 'tsx', '--eval', "import('./src/lib/database.ts')"]],
      ['media runtime', process.execPath,
        ['--import', 'tsx', '--eval', "import('./src/lib/media.ts')"]],
      ['authentication and catalog migration', 'npm', ['run', 'db:migrate']],
      ['catalog seed', 'npm', ['run', 'db:seed']],
      ['notification maintenance', 'npm', ['run', 'notifications:deliver', '--', '--limit', '1']],
      ['billing maintenance', 'npm', ['run', 'billing:reconcile', '--', '--limit', '1']],
      ['backup maintenance', 'npm',
        ['run', 'ops:backup', '--', '--output', malformedBackup, '--key-file', keyFile]],
      ['restore maintenance', 'npm',
        ['run', 'ops:restore', '--', '--backup', backup, '--target', malformedRestore]],
      ['health check', process.execPath, ['scripts/healthcheck.mjs']],
    ];
    for (const [label, command, args] of commands) {
      reject(`${label} (${name})`, command, args, url);
      expect(!existsSync(`${malformedDatabase}?mode=ro`),
        `${label} created a query-bearing database file`);
      expect(!existsSync(malformedBackup), `${label} created a backup from a malformed URL`);
      expect(!existsSync(malformedRestore), `${label} restored beside a malformed URL`);
    }
  }

  run('db:migrate', [], { DATABASE_URL: `file:${overrideDb}` });
  run('db:seed', [], { DATABASE_URL: `file:${overrideDb}` });
  expect(hasTable(overrideDb, 'user'), 'Explicit DATABASE_URL missed authentication migration');
  expect(rowCount(overrideDb, 'listings') >= 2, 'Explicit DATABASE_URL did not override .env.local');
  expect(!existsSync(defaultDb), 'Override run created the default database');

  const defaultProductionDb = join(sandbox, 'default-production.db');
  const explicitProductionDb = join(sandbox, 'explicit-production.db');
  const developmentDb = join(sandbox, 'development.db');
  const testDb = join(sandbox, 'test.db');
  writeFileSync(join(sandbox, '.env.production.local'), `DATABASE_URL=file:${defaultProductionDb}\n`);
  writeFileSync(join(sandbox, '.env.development.local'), `DATABASE_URL=file:${developmentDb}\n`);
  writeFileSync(join(sandbox, '.env.test.local'), `DATABASE_URL=file:${testDb}\n`);

  run('db:migrate');
  run('db:seed');
  expect(existsSync(defaultProductionDb), 'Unset NODE_ENV did not select the production database');
  expect(hasTable(defaultProductionDb, 'user'), 'Authentication migration missed the default production database');
  expect(rowCount(defaultProductionDb, 'listings') >= 2, 'Catalog migration or seed missed the default production database');
  expect(!existsSync(developmentDb), 'Unset NODE_ENV selected the development database');
  expect(!existsSync(testDb), 'Unset NODE_ENV selected the test database');

  writeFileSync(join(sandbox, '.env.production.local'), `DATABASE_URL=file:${explicitProductionDb}\n`);
  run('db:migrate', [], { NODE_ENV: 'production' });
  run('db:seed', [], { NODE_ENV: 'production' });
  expect(hasTable(explicitProductionDb, 'user'), 'Authentication migration missed the explicit production database');
  expect(rowCount(explicitProductionDb, 'listings') >= 2, 'Catalog migration or seed missed the explicit production database');

  run('db:migrate', [], { NODE_ENV: 'development' });
  run('db:seed', [], { NODE_ENV: 'development' });
  expect(hasTable(developmentDb, 'user'), 'Authentication migration missed the explicit development database');
  expect(rowCount(developmentDb, 'listings') >= 2, 'Catalog migration or seed missed the explicit development database');

  run('db:migrate', [], { NODE_ENV: 'test' });
  run('db:seed', [], { NODE_ENV: 'test' });
  expect(hasTable(testDb, 'user'), 'Authentication migration missed the explicit test database');
  expect(rowCount(testDb, 'listings') >= 2, 'Catalog migration or seed missed the explicit test database');
  expect(!existsSync(defaultDb), 'Mode-specific run created the default database');

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
