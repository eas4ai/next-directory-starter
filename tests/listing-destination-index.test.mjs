import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('listing writers maintain an indexed normalized destination key', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'directory-listing-destination-'));
  const previousDatabase = process.env.DATABASE_URL;
  process.env.DATABASE_URL = `file:${join(directory, 'catalog.db')}`;
  let database;
  try {
    ({ database } = await import('../src/lib/database.ts'));
    const { migrateCatalog, seedCatalog } = await import('../src/lib/catalog-migrations.ts');
    seedCatalog();
    database.exec(`CREATE TABLE IF NOT EXISTS "user" (
      id TEXT PRIMARY KEY, role TEXT, banned INTEGER NOT NULL, emailVerified INTEGER NOT NULL
    )`);
    database.prepare(`INSERT INTO "user" (id, role, banned, emailVerified)
      VALUES ('admin', 'admin', 0, 1)`).run();
    const { createListing, updateListing } = await import('../src/lib/listings.ts');
    const { createOwnerListing, updateOwnerListing } = await import('../src/lib/moderation.ts');
    const { stageAgentImports } = await import('../src/lib/agent-imports.ts');

    const operator = createListing({
      slug: 'operator-item', name: 'Operator item', summary: 'Operator summary',
      description: 'Operator description', category: 'Tools',
      url: 'https://EXAMPLE.org:443/Path?Query=Value#ignored', status: 'draft', revision: 1,
    }, 'admin');
    assert.equal(database.prepare(`SELECT destination_key FROM listings WHERE slug = ?`)
      .get(operator.slug).destination_key, 'https://example.org/Path?Query=Value');
    updateListing({ ...operator, url: 'https://example.org/Changed#fragment' }, 'admin', 1);
    assert.equal(database.prepare(`SELECT destination_key FROM listings WHERE slug = ?`)
      .get(operator.slug).destination_key, 'https://example.org/Changed');

    createOwnerListing('owner', {
      slug: 'owner-item', name: 'Owner item', summary: 'Owner summary',
      description: 'Owner description', category: 'Tools',
      url: 'https://owner.example.org/First#fragment',
    });
    updateOwnerListing('owner', 'owner-item', { url: 'https://OWNER.example.org/Second#fragment' });
    assert.equal(database.prepare(`SELECT destination_key FROM listings WHERE slug = 'owner-item'`)
      .get().destination_key, 'https://owner.example.org/Second');

    database.prepare(`INSERT INTO listings
      (slug, name, summary, description, category, url, status)
      VALUES ('legacy-item', 'Legacy item', 'Legacy summary', 'Legacy description', 'Tools',
        'https://LEGACY.example.org:443/Path#old', 'draft')`).run();
    database.prepare('DELETE FROM catalog_migrations WHERE version = 30').run();
    migrateCatalog();
    assert.equal(database.prepare(`SELECT destination_key FROM listings WHERE slug = 'legacy-item'`)
      .get().destination_key, 'https://legacy.example.org/Path');

    const [duplicate] = stageAgentImports('admin', { kind: 'key', id: 'key-a' }, [{
      idempotencyKey: 'legacy-duplicate', url: 'https://legacy.example.org/Path',
      sourceUrl: 'https://source.example.org/list', sourceExcerpt: 'Observed legacy link',
      name: 'Legacy duplicate', summary: 'Duplicate summary',
      description: 'Duplicate description', category: 'Tools',
    }]);
    assert.deepEqual(duplicate, { status: 'duplicate', slug: 'legacy-item' });
    assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM agent_staging_usage
      WHERE principal = 'key:key-a'`).get().count, 0);

    database.prepare(`INSERT INTO listings
      (slug, name, summary, description, category, url, status)
      VALUES ('late-legacy', 'Late legacy', 'Late summary', 'Late description', 'Tools',
        'https://LATE.example.org:443/Path#old', 'draft')`).run();
    const [lateDuplicate] = stageAgentImports('admin', { kind: 'key', id: 'key-a' }, [{
      idempotencyKey: 'late-legacy-duplicate', url: 'https://late.example.org/Path',
      sourceUrl: 'https://source.example.org/list', sourceExcerpt: 'Observed late legacy link',
      name: 'Late legacy duplicate', summary: 'Duplicate summary',
      description: 'Duplicate description', category: 'Tools',
    }]);
    assert.deepEqual(lateDuplicate, { status: 'duplicate', slug: 'late-legacy' });
    assert.equal(database.prepare(`SELECT destination_key FROM listings WHERE slug = 'late-legacy'`)
      .get().destination_key, 'https://late.example.org/Path');

    const indexes = database.prepare('PRAGMA index_list(listings)').all().map(({ name }) => name);
    assert.ok(indexes.includes('listings_destination_key'));
    const plan = database.prepare(`EXPLAIN QUERY PLAN
      SELECT slug FROM listings WHERE destination_key = ? LIMIT 1`)
      .all('https://legacy.example.org/Path').map(({ detail }) => detail).join('\n');
    assert.match(plan, /USING INDEX listings_destination_key/);
    assert.deepEqual(database.prepare(`SELECT slug, destination_key FROM listings
      WHERE slug IN ('example-tool', 'hidden-draft') ORDER BY slug`).all(), [
      { slug: 'example-tool', destination_key: 'https://example.org/tool' },
      { slug: 'hidden-draft', destination_key: 'https://example.org/draft' },
    ]);
  } finally {
    database?.close();
    if (previousDatabase === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabase;
    rmSync(directory, { recursive: true, force: true });
  }
});
