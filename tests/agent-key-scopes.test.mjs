import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('agent keys default to staging and preserve explicit publication access', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'directory-agent-key-scopes-'));
  const previousDatabase = process.env.DATABASE_URL;
  process.env.DATABASE_URL = `file:${join(directory, 'catalog.db')}`;
  let database;
  try {
    ({ database } = await import('../src/lib/database.ts'));
    const { migrateCatalog } = await import('../src/lib/catalog-migrations.ts');
    const { issueAgentKey, listAgentKeys } = await import('../src/lib/agent-keys.ts');
    migrateCatalog();

    const staged = issueAgentKey('catalog-user', 'Collector', 30);
    assert.equal(staged.scope, 'stage');
    assert.equal(database.prepare('SELECT scope FROM agent_keys WHERE id = ?')
      .get(staged.id).scope, 'stage');

    const publisher = issueAgentKey('catalog-user', 'Publisher', 30, 'publish');
    assert.equal(publisher.scope, 'publish');
    assert.throws(() => issueAgentKey('catalog-user', 'Invalid', 30, 'admin'));

    database.prepare(`INSERT INTO agent_keys
      (id, user_id, name, token_hash, expires_at, revoked_at, created_at)
      VALUES ('legacy-key', 'catalog-user', 'Legacy', 'legacy-hash', ?, NULL, ?)`)
      .run(new Date(Date.now() + 86_400_000).toISOString(), new Date().toISOString());
    const keys = listAgentKeys('catalog-user');
    assert.equal(keys.find((key) => key.id === staged.id)?.scope, 'stage');
    assert.equal(keys.find((key) => key.id === publisher.id)?.scope, 'publish');
    assert.equal(keys.find((key) => key.id === 'legacy-key')?.scope, 'publish');
  } finally {
    database?.close();
    if (previousDatabase === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabase;
    rmSync(directory, { recursive: true, force: true });
  }
});
