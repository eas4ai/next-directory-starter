import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('overview counts current public work, limits private activity, and fails on missing data', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'directory-overview-'));
  const previousDatabase = process.env.DATABASE_URL;
  process.env.DATABASE_URL = `file:${join(directory, 'catalog.db')}`;
  let database;
  try {
    ({ database } = await import('../src/lib/database.ts'));
    const { migrateCatalog } = await import('../src/lib/catalog-migrations.ts');
    const { overviewData } = await import('../src/lib/overview.ts');
    const { recordAudit } = await import('../src/lib/audit.ts');
    migrateCatalog();
    database.exec('CREATE TABLE IF NOT EXISTS "user" (id TEXT PRIMARY KEY, email TEXT, banned INTEGER NOT NULL DEFAULT 0)');
    assert.deepEqual(overviewData(false), {
      publicListings: 0, publishedArticles: 0, pendingSubmissions: 0,
    });
    database.prepare('INSERT INTO categories (name) VALUES (?)').run('Tools');
    const insertListing = database.prepare(`INSERT INTO listings
      (slug, name, summary, description, category, url, status, owner_user_id)
      VALUES (?, ?, 'Summary', 'Description', 'Tools', 'https://example.org', ?, ?)`);
    insertListing.run('published', 'Published', 'published', null);
    insertListing.run('suspended', 'Suspended', 'suspended', null);
    database.prepare('INSERT INTO "user" (id, email, banned) VALUES (?, ?, 1)')
      .run('banned-owner', 'banned@example.invalid');
    insertListing.run('banned', 'Banned', 'published', 'banned-owner');
    const insertArticle = database.prepare(`INSERT INTO articles
      (slug, title, summary, body, status, author_user_id, created_at, updated_at)
      VALUES (?, 'Title', 'Summary', 'Body', ?, 'editor', '2026-10-10', '2026-10-10')`);
    insertArticle.run('public-article', 'published');
    insertArticle.run('private-article', 'draft');
    const insertSubmission = database.prepare(`INSERT INTO submissions
      (id, slug, owner_user_id, payload, status, submitted_at)
      VALUES (?, 'published', 'owner', '{}', ?, '2026-10-10')`);
    insertSubmission.run('pending', 'pending');
    insertSubmission.run('reviewed', 'approved');
    for (let index = 0; index < 7; index += 1) {
      recordAudit('test.change', 'admin', `target-${index}`);
    }
    assert.deepEqual(overviewData(false), {
      publicListings: 1, publishedArticles: 1, pendingSubmissions: 1,
    });
    const adminView = overviewData(true);
    assert.equal(adminView.recentActivity?.length, 5);
    database.prepare("UPDATE submissions SET status = 'approved' WHERE id = 'pending'").run();
    assert.equal(overviewData(false).pendingSubmissions, 0);
    database.exec('DROP TABLE articles');
    assert.throws(() => overviewData(false), /no such table/i);
  } finally {
    database?.close();
    if (previousDatabase === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabase;
    rmSync(directory, { recursive: true, force: true });
  }
});
