import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';

test('legacy paid purchases survive plan-mode migration with their accepted terms', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'directory-plan-migration-'));
  const filename = join(directory, 'catalog.db');
  const prior = {
    database: process.env.DATABASE_URL,
    stripe: process.env.STRIPE_SECRET_KEY,
    mode: process.env.BILLING_CHECKOUT_MODE,
  };
  process.env.DATABASE_URL = `file:${filename}`;
  process.env.STRIPE_SECRET_KEY = 'sk_live_migration_fixture';
  delete process.env.BILLING_CHECKOUT_MODE;
  const legacy = new Database(filename);
  legacy.pragma('foreign_keys = ON');
  legacy.exec(readFileSync(new URL('../fixtures/catalog-v6.sql', import.meta.url), 'utf8'));
  legacy.exec(`INSERT INTO categories VALUES ('Tools');
    INSERT INTO listings (slug, name, summary, description, category, url, status)
      VALUES ('existing-listing', 'Existing listing', 'Summary', 'Description',
        'Tools', 'https://example.org/existing', 'published');
    INSERT INTO publishing_plans VALUES
      ('existing-plan','Original plan','Original description',1200,'usd',30,1,1,'2026-01-01');
    INSERT INTO purchases VALUES
      ('purchase-1','existing-listing','owner','existing-plan',1200,'usd',30,1,
        'cs_existing',NULL,'paid','2026-01-01',NULL,'Original plan · Existing listing');`);
  assert.deepEqual(legacy.pragma('foreign_key_check'), []);
  legacy.close();

  let database;
  try {
    ({ database } = await import('../src/lib/database.ts'));
    const { migrateCatalog } = await import('../src/lib/catalog-migrations.ts');
    migrateCatalog();
    migrateCatalog();
    assert.equal(database.pragma('foreign_keys', { simple: true }), 1);
    assert.deepEqual(database.pragma('foreign_key_check'), []);
    const plan = database.prepare('SELECT * FROM publishing_plans WHERE key = ?').get('existing-plan');
    assert.equal(plan.mode, 'live');
    assert.equal(plan.billing_mode, 'one-time');
    const purchase = database.prepare('SELECT * FROM purchases WHERE id = ?').get('purchase-1');
    assert.deepEqual([purchase.amount_minor, purchase.currency, purchase.duration_days,
      purchase.featured, purchase.plan_mode, purchase.billing_mode, purchase.plan_name,
      purchase.accepted_duration_days],
      [1200, 'usd', 30, 1, 'live', 'one-time', 'Original plan', 30]);
    database.prepare("UPDATE publishing_plans SET name = 'New plan', amount_minor = 2500 WHERE key = 'existing-plan'").run();
    assert.equal(database.prepare('SELECT amount_minor FROM purchases WHERE id = ?').get('purchase-1').amount_minor, 1200);
    database.prepare(`INSERT INTO publishing_plans
      (key, name, description, mode, billing_mode, amount_minor, currency,
        duration_days, featured, enabled, updated_at)
      VALUES ('free','Free','', 'live','free',0,'usd',NULL,0,1,'2026-01-01')`).run();
    assert.throws(() => database.prepare(`INSERT INTO purchases
      (id, listing_slug, owner_user_id, plan_key, amount_minor, currency, duration_days,
        featured, stripe_session_id, status, created_at)
      VALUES ('bad','existing-listing','owner','missing-plan',0,'usd',0,0,'free:bad','paid','2026-01-01')`).run(),
    /FOREIGN KEY/);
  } finally {
    database?.close();
    if (prior.database === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prior.database;
    if (prior.stripe === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = prior.stripe;
    if (prior.mode === undefined) delete process.env.BILLING_CHECKOUT_MODE;
    else process.env.BILLING_CHECKOUT_MODE = prior.mode;
    rmSync(directory, { recursive: true, force: true });
  }
});
