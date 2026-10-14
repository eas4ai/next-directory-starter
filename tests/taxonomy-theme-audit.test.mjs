import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('taxonomy and theme changes record atomic actor audit events', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'directory-taxonomy-theme-audit-'));
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = `file:${join(directory, 'catalog.db')}`;
  let database;
  try {
    ({ database } = await import('../src/lib/database.ts'));
    const { migrateCatalog } = await import('../src/lib/catalog-migrations.ts');
    const { createTaxon, renameTaxon, deleteTaxon, listTaxa } =
      await import('../src/lib/taxonomy.ts');
    const { defaultThemePreset, getThemePreset, saveThemePreset } =
      await import('../src/lib/theme.ts');
    migrateCatalog();
    database.exec(`CREATE TABLE IF NOT EXISTS "user" (
      id TEXT PRIMARY KEY, role TEXT, banned INTEGER NOT NULL DEFAULT 0,
      emailVerified INTEGER NOT NULL DEFAULT 0
    )`);
    database.prepare(`INSERT INTO "user" (id, role, banned, emailVerified)
      VALUES ('administrator', 'admin', 0, 1)`).run();

    createTaxon('category', 'Original', 'administrator');
    renameTaxon('category', 'Original', 'Renamed', 'administrator');
    createTaxon('tag', 'Unused', 'administrator');
    deleteTaxon('tag', 'Unused', 'administrator');
    const changedTheme = {
      ...defaultThemePreset,
      theme: defaultThemePreset.theme === 'blue' ? 'red' : 'blue',
    };
    saveThemePreset(changedTheme, 'administrator');
    assert.deepEqual(getThemePreset(), changedTheme);

    const events = database.prepare(`SELECT action, actor_user_id AS actor,
      target, occurred_at AS occurredAt FROM audit_events`).all();
    for (const [action, target] of [
      ['taxonomy.category.create', 'Original'],
      ['taxonomy.category.rename', 'Original -> Renamed'],
      ['taxonomy.tag.delete', 'Unused'],
      ['site.theme.save', 'site'],
    ]) {
      assert.ok(events.some((event) => event.action === action &&
        event.target === target && event.actor === 'administrator' &&
        Number.isFinite(Date.parse(event.occurredAt))), `${action} audit event is missing`);
    }

    createTaxon('tag', 'Protected', 'administrator');
    database.prepare(`UPDATE "user" SET role = 'user' WHERE id = 'administrator'`).run();
    assert.throws(() => createTaxon('tag', 'Revoked create', 'administrator'), /Forbidden/);
    assert.equal(listTaxa('tag').some(({ name }) => name === 'Revoked create'), false);
    database.prepare(`UPDATE "user" SET role = 'taxonomy', banned = 1
      WHERE id = 'administrator'`).run();
    assert.throws(() => renameTaxon('tag', 'Protected', 'Revoked rename', 'administrator'), /Forbidden/);
    assert.equal(listTaxa('tag').some(({ name }) => name === 'Protected'), true);
    database.prepare(`UPDATE "user" SET banned = 0, emailVerified = 0
      WHERE id = 'administrator'`).run();
    assert.throws(() => deleteTaxon('tag', 'Protected', 'administrator'), /Forbidden/);
    assert.equal(listTaxa('tag').some(({ name }) => name === 'Protected'), true);
    const rolledBackTheme = {
      ...changedTheme,
      theme: changedTheme.theme === 'blue' ? 'red' : 'blue',
    };
    database.prepare(`UPDATE "user" SET role = 'taxonomy', emailVerified = 1
      WHERE id = 'administrator'`).run();
    assert.throws(() => saveThemePreset(rolledBackTheme, 'administrator'), /Forbidden/);
    assert.deepEqual(getThemePreset(), changedTheme);
  } finally {
    database?.close();
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});
