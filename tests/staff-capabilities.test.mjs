import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('staff capabilities stay separate and role changes protect account boundaries', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'directory-staff-'));
  const previousDatabase = process.env.DATABASE_URL;
  const previousAuthUrl = process.env.BETTER_AUTH_URL;
  process.env.DATABASE_URL = `file:${join(directory, 'catalog.db')}`;
  process.env.BETTER_AUTH_URL = 'https://directory.example';
  let database;
  try {
    ({ database } = await import('../src/lib/database.ts'));
    const { migrateCatalog } = await import('../src/lib/catalog-migrations.ts');
    const { canonicalAccountRole } = await import('../src/lib/staff-roles.ts');
    const { canAdmin, canEditArticles, canManageBilling, canManageCatalog,
      canManageTaxonomy, canModerate } = await import('../src/lib/admin.ts');
    const { changeAccountRole, changeAccountSuspension } = await import('../src/lib/accounts.ts');
    const { allListings, listingBySlug } = await import('../src/lib/listings.ts');
    migrateCatalog();
    database.exec(`CREATE TABLE IF NOT EXISTS "user" (
      id TEXT PRIMARY KEY, name TEXT, email TEXT, role TEXT, banned INTEGER NOT NULL DEFAULT 0,
      emailVerified INTEGER NOT NULL DEFAULT 0, banReason TEXT, banExpires INTEGER
    );
    CREATE TABLE IF NOT EXISTS session (id TEXT PRIMARY KEY, userId TEXT NOT NULL);`);
    const addAccount = database.prepare(`INSERT INTO "user" (id, name, email, role, banned, emailVerified)
      VALUES (?, ?, ?, ?, ?, ?)`);
    addAccount.run('admin', 'Admin', 'admin@example.invalid', 'admin', 0, 1);
    addAccount.run('staff', 'Staff', 'staff@example.invalid', 'user', 0, 1);
    addAccount.run('unverified', 'Unverified', 'unverified@example.invalid', 'user', 0, 0);
    addAccount.run('suspended', 'Suspended', 'suspended@example.invalid', 'user', 1, 1);

    assert.equal(canonicalAccountRole('billing,catalog'), 'catalog,billing');
    for (const invalid of ['admin,moderator', 'catalog,catalog', 'user,billing', 'unknown', '']) {
      assert.equal(canonicalAccountRole(invalid), null);
    }
    const role = changeAccountRole('admin', 'staff', 'billing,catalog');
    assert.equal(role.role, 'catalog,billing');
    assert.equal(canManageCatalog(role.role), true);
    assert.equal(canManageBilling(role.role), true);
    assert.equal(canAdmin(role.role), false);
    assert.equal(canModerate(role.role), false);
    assert.equal(canEditArticles(role.role), false);
    assert.equal(canManageTaxonomy(role.role), false);
    assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM audit_events
      WHERE action = 'account.role' AND actor_user_id = 'admin' AND target = 'staff'`)
      .get().count, 1);
    assert.throws(() => changeAccountRole('admin', 'unverified', 'moderator'), /Verify and reinstate/);
    assert.throws(() => changeAccountRole('admin', 'suspended', 'editor'), /Verify and reinstate/);
    addAccount.run('other-admin', 'Other', 'other@example.invalid', 'admin', 0, 0);
    assert.throws(() => changeAccountRole('admin', 'admin', 'user'), /Keep at least one administrator/);
    assert.throws(() => changeAccountSuspension('admin', 'admin', true, 'Test'), /Keep at least one active administrator/);

    database.prepare('INSERT INTO categories (name) VALUES (?)').run('Tools');
    const addListing = database.prepare(`INSERT INTO listings
      (slug, name, summary, description, category, url, status, owner_user_id)
      VALUES (?, ?, 'Summary', 'Description', 'Tools', 'https://example.org', 'published', ?)`);
    addListing.run('operator-entry', 'Operator entry', null);
    addListing.run('owner-entry', 'Owner entry', 'staff');
    assert.equal(allListings().length, 2);
    assert.deepEqual(allListings(true).map((listing) => listing.slug), ['operator-entry']);
    assert.equal(listingBySlug('owner-entry', true), undefined);
  } finally {
    database?.close();
    if (previousDatabase === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabase;
    if (previousAuthUrl === undefined) delete process.env.BETTER_AUTH_URL;
    else process.env.BETTER_AUTH_URL = previousAuthUrl;
    rmSync(directory, { recursive: true, force: true });
  }
});
