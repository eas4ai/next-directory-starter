import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('agent staging persists independent quota and hourly limits per principal', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'directory-agent-staging-limits-'));
  const previousDatabase = process.env.DATABASE_URL;
  process.env.DATABASE_URL = `file:${join(directory, 'catalog.db')}`;
  let database;
  try {
    ({ database } = await import('../src/lib/database.ts'));
    const { migrateCatalog } = await import('../src/lib/catalog-migrations.ts');
    const { stageAgentImports } = await import('../src/lib/agent-imports.ts');
    migrateCatalog();
    database.prepare("INSERT INTO categories (name) VALUES ('Tools')").run();

    const item = (suffix) => ({
      idempotencyKey: `item-${suffix}`,
      url: `https://example.org/${suffix}`,
      sourceUrl: `https://source.example.org/${suffix}`,
      sourceExcerpt: `Observed source ${suffix}`,
      name: `Imported item ${suffix}`,
      summary: `Summary for ${suffix}`,
      description: `Description for ${suffix}`,
      category: 'Tools',
    });
    const keyA = { kind: 'key', id: 'key-a' };
    const keyB = { kind: 'key', id: 'key-b' };
    const browser = { kind: 'account', id: 'catalog-user' };

    const [first] = stageAgentImports('catalog-user', keyA, [item('first')]);
    assert.equal(first.status, 'created');
    const [retry] = stageAgentImports('catalog-user', keyB, [item('first')]);
    assert.deepEqual(retry, { status: 'existing', slug: first.slug });
    const [duplicate] = stageAgentImports('catalog-user', keyB,
      [{ ...item('duplicate'), url: item('first').url }]);
    assert.deepEqual(duplicate, { status: 'duplicate', slug: first.slug });
    assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM agent_staging_usage
      WHERE principal = 'key:key-b'`).get().count, 0);

    database.prepare(`UPDATE agent_staging_usage
      SET lifetime_created = 499, window_created = 99 WHERE principal = 'key:key-a'`).run();
    const [lastAllowed] = stageAgentImports('catalog-user', keyA, [item('last-allowed')]);
    assert.equal(lastAllowed.status, 'created');
    assert.deepEqual(database.prepare(`SELECT lifetime_created, window_created
      FROM agent_staging_usage WHERE principal = 'key:key-a'`).get(), {
      lifetime_created: 500,
      window_created: 100,
    });
    const [quotaBlocked] = stageAgentImports('catalog-user', keyA, [item('quota-blocked')]);
    assert.deepEqual(quotaBlocked, {
      status: 'limited',
      error: 'Staging quota reached for this credential',
    });

    database.prepare(`INSERT INTO agent_staging_usage
      (principal, lifetime_created, window_started_at, window_created, updated_at)
      VALUES ('key:key-b', 20, ?, 100, ?)`).run(
      new Date().toISOString().slice(0, 13) + ':00:00.000Z', new Date().toISOString());
    const [rateBlocked] = stageAgentImports('catalog-user', keyB, [item('rate-blocked')]);
    assert.deepEqual(rateBlocked, {
      status: 'limited',
      error: 'Hourly staging limit reached; try again next hour',
    });
    database.prepare(`UPDATE agent_staging_usage SET window_started_at = ?
      WHERE principal = 'key:key-b'`).run('2026-01-01T00:00:00.000Z');
    const [afterRollover] = stageAgentImports('catalog-user', keyB, [item('after-rollover')]);
    assert.equal(afterRollover.status, 'created');
    assert.deepEqual(database.prepare(`SELECT lifetime_created, window_created
      FROM agent_staging_usage WHERE principal = 'key:key-b'`).get(), {
      lifetime_created: 21,
      window_created: 1,
    });

    const [browserCreated] = stageAgentImports('catalog-user', browser, [item('browser')]);
    assert.equal(browserCreated.status, 'created');
    assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM agent_staging_usage
      WHERE principal = 'account:catalog-user'`).get().count, 1);
    assert.equal(database.prepare(`SELECT staging_principal FROM agent_imports
      WHERE slug = ?`).get(browserCreated.slug).staging_principal, 'account:catalog-user');
  } finally {
    database?.close();
    if (previousDatabase === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabase;
    rmSync(directory, { recursive: true, force: true });
  }
});
