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

    assert.throws(() => createTaxon('tag', 'Rolled back', ''), /Audit event/);
    assert.equal(listTaxa('tag').some(({ name }) => name === 'Rolled back'), false);
    const rolledBackTheme = {
      ...changedTheme,
      theme: changedTheme.theme === 'blue' ? 'red' : 'blue',
    };
    assert.throws(() => saveThemePreset(rolledBackTheme, ''), /Audit event/);
    assert.deepEqual(getThemePreset(), changedTheme);
  } finally {
    database?.close();
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});
