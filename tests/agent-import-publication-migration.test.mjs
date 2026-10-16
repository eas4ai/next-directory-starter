import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('migration records the first audited publication for legacy agent imports', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'directory-agent-import-migration-'));
  const previousDatabase = process.env.DATABASE_URL;
  process.env.DATABASE_URL = `file:${join(directory, 'catalog.db')}`;
  let database;
  try {
    ({ database } = await import('../src/lib/database.ts'));
    const { migrateCatalog } = await import('../src/lib/catalog-migrations.ts');
    migrateCatalog();
    database.prepare('DELETE FROM catalog_migrations WHERE version = 23').run();
    database.prepare("INSERT INTO categories (name) VALUES ('Tools')").run();
    database.prepare(`INSERT INTO listings
      (slug, name, summary, description, category, url, status)
      VALUES ('legacy-import', 'Legacy import', 'Summary', 'Description', 'Tools',
        'https://example.org/legacy', 'published')`).run();
    database.prepare(`INSERT INTO agent_imports
      (slug, actor_user_id, idempotency_key, source_url, source_excerpt, created_at)
      VALUES ('legacy-import', 'importer', 'legacy-key', 'https://example.org/source',
        'Source excerpt', '2026-10-01T00:00:00.000Z')`).run();
    database.prepare(`INSERT INTO audit_events
      (id, action, actor_user_id, target, occurred_at)
      VALUES (?, 'catalog.publish', ?, 'legacy-import', ?)`).run(
      'publish-later', 'later-publisher', '2026-10-03T00:00:00.000Z');
    database.prepare(`INSERT INTO audit_events
      (id, action, actor_user_id, target, occurred_at)
      VALUES (?, 'catalog.publish', ?, 'legacy-import', ?)`).run(
      'publish-first', 'first-publisher', '2026-10-02T00:00:00.000Z');

    migrateCatalog();
    migrateCatalog();

    assert.deepEqual(database.prepare(`SELECT published_at, published_by
      FROM agent_imports WHERE slug = 'legacy-import'`).get(), {
      published_at: '2026-10-02T00:00:00.000Z',
      published_by: 'first-publisher',
    });
    assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM catalog_migrations
      WHERE version = 23`).get().count, 1);
  } finally {
    database?.close();
    if (previousDatabase === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabase;
    rmSync(directory, { recursive: true, force: true });
  }
});
