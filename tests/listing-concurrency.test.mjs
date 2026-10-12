import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('stale catalog edits cannot reverse a moderator suspension', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'directory-listing-concurrency-'));
  const previousDatabase = process.env.DATABASE_URL;
  const previousAuthUrl = process.env.BETTER_AUTH_URL;
  process.env.DATABASE_URL = `file:${join(directory, 'catalog.db')}`;
  process.env.BETTER_AUTH_URL = 'https://directory.example';
  let database;
  try {
    ({ database } = await import('../src/lib/database.ts'));
    const { migrateCatalog } = await import('../src/lib/catalog-migrations.ts');
    const { listingBySlug, publishedListingBySlug, updateListing } = await import('../src/lib/listings.ts');
    const { suspendPublishedListing } = await import('../src/lib/moderation.ts');
    migrateCatalog();
    database.exec(`CREATE TABLE IF NOT EXISTS "user" (
      id TEXT PRIMARY KEY, name TEXT, email TEXT, role TEXT, banned INTEGER NOT NULL DEFAULT 0,
      emailVerified INTEGER NOT NULL DEFAULT 0, banReason TEXT, banExpires INTEGER
    );`);
    database.prepare(`INSERT INTO "user" (id, name, email, role, banned, emailVerified)
      VALUES (?, ?, ?, ?, 0, 1)`).run('catalog-user', 'Catalog user', 'catalog@example.invalid', 'catalog');
    database.prepare('INSERT INTO categories (name) VALUES (?)').run('Tools');
    database.prepare(`INSERT INTO listings
      (slug, name, summary, description, category, url, status, owner_user_id)
      VALUES (?, ?, 'Summary', 'Description', 'Tools', 'https://example.org', 'published', NULL)`)
      .run('race-entry', 'Original name');

    const stale = listingBySlug('race-entry');
    assert.equal(stale?.revision, 1);
    suspendPublishedListing('race-entry', 'moderator-user', 'Unsafe destination');

    assert.throws(
      () => updateListing({ ...stale, name: 'Stale catalog edit' }, 'catalog-user', stale.revision),
      (error) => error?.status === 409 && /changed since it was opened/i.test(error.message),
    );
    const suspended = listingBySlug('race-entry');
    assert.equal(suspended?.status, 'suspended');
    assert.equal(suspended?.name, 'Original name');
    assert.equal(suspended?.revision, 2);
    assert.equal(publishedListingBySlug('race-entry'), undefined);

    assert.throws(
      () => updateListing({ ...suspended, status: 'published' }, 'catalog-user', suspended.revision),
      (error) => error?.status === 403 && /moderation permission required/i.test(error.message),
    );
    assert.equal(listingBySlug('race-entry')?.status, 'suspended');
  } finally {
    database?.close();
    if (previousDatabase === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabase;
    if (previousAuthUrl === undefined) delete process.env.BETTER_AUTH_URL;
    else process.env.BETTER_AUTH_URL = previousAuthUrl;
    rmSync(directory, { recursive: true, force: true });
  }
});
