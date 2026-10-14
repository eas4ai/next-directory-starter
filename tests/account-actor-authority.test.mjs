import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('account mutations reject actors whose administrator authority was revoked', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'directory-account-authority-'));
  const previousDatabase = process.env.DATABASE_URL;
  process.env.DATABASE_URL = `file:${join(directory, 'catalog.db')}`;
  let database;
  try {
    ({ database } = await import('../src/lib/database.ts'));
    const { migrateCatalog } = await import('../src/lib/catalog-migrations.ts');
    const { changeAccountRole, changeAccountSuspension } = await import('../src/lib/accounts.ts');
    migrateCatalog();
    database.exec(`CREATE TABLE IF NOT EXISTS "user" (
      id TEXT PRIMARY KEY, name TEXT, email TEXT, role TEXT, banned INTEGER NOT NULL DEFAULT 0,
      emailVerified INTEGER NOT NULL DEFAULT 0, banReason TEXT, banExpires INTEGER
    );
    CREATE TABLE IF NOT EXISTS session (id TEXT PRIMARY KEY, userId TEXT NOT NULL);`);
    const addAccount = database.prepare(`INSERT INTO "user" (id, name, email, role, banned, emailVerified)
      VALUES (?, ?, ?, ?, ?, ?)`);
    addAccount.run('demoted-actor', 'Demoted', 'demoted@example.invalid', 'user', 0, 1);
    addAccount.run('suspended-actor', 'Suspended', 'suspended@example.invalid', 'admin', 1, 1);
    addAccount.run('unverified-actor', 'Unverified', 'unverified@example.invalid', 'admin', 0, 0);
    addAccount.run('target', 'Target', 'target@example.invalid', 'user', 0, 1);

    assert.throws(
      () => changeAccountRole('demoted-actor', 'demoted-actor', 'admin'),
      /Forbidden/,
    );
    assert.throws(
      () => changeAccountSuspension('suspended-actor', 'suspended-actor', false, undefined),
      /Forbidden/,
    );
    assert.throws(
      () => changeAccountRole('unverified-actor', 'target', 'editor'),
      /Forbidden/,
    );
  } finally {
    database?.close();
    if (previousDatabase === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabase;
    rmSync(directory, { recursive: true, force: true });
  }
});
