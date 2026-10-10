import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('findings detect missing and duplicate public titles and previews use published metadata', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'directory-seo-findings-'));
  const previousDatabase = process.env.DATABASE_URL;
  const previousUrl = process.env.SITE_URL;
  process.env.DATABASE_URL = `file:${join(directory, 'catalog.db')}`;
  process.env.SITE_URL = 'https://directory.example';
  let database;
  try {
    ({ database } = await import('../src/lib/database.ts'));
    const { migrateCatalog } = await import('../src/lib/catalog-migrations.ts');
    const { createListing } = await import('../src/lib/listings.ts');
    const { createArticle } = await import('../src/lib/articles.ts');
    const { saveDraftSeo, publishDraftSeo, saveSeoSettings } = await import('../src/lib/seo-settings.ts');
    const { seoFindings, seoPreview } = await import('../src/lib/seo-findings.ts');
    migrateCatalog();
    database.exec('CREATE TABLE IF NOT EXISTS "user" (id TEXT PRIMARY KEY, email TEXT, banned INTEGER NOT NULL DEFAULT 0)');
    const listing = (slug) => ({ slug, name: 'Duplicate title', summary: 'Short',
      description: 'Description', category: 'Tools', url: `https://example.org/${slug}`, status: 'published' });
    createListing(listing('first'), 'admin');
    createListing(listing('second'), 'admin');
    createArticle({ slug: 'private-draft', title: 'Private title', summary: 'Summary',
      body: 'Body', status: 'draft', tags: [] }, 'editor');
    saveSeoSettings({ titleFormat: '%s | Search', description: 'Site description',
      socialImage: '/social.png' }, 'admin');
    let report = seoFindings();
    assert.equal(report.findings.filter((row) => row.code === 'duplicate-title').length, 2);
    assert.throws(() => seoPreview('article', 'private-draft'), /not found/i);
    const before = seoPreview('listing', 'first');
    assert.equal(before.search.title, 'Duplicate title | Directory Starter | Search');
    saveDraftSeo('listing', 'first', { title: 'Private alternate', socialImage: '/private.png' });
    assert.equal(seoPreview('listing', 'first').search.title, before.search.title);
    publishDraftSeo('listing', 'first');
    const after = seoPreview('listing', 'first');
    assert.equal(after.search.title, 'Private alternate | Search');
    assert.equal(after.social.image,
      'https://directory.example/social-card?path=%2Flistings%2Ffirst');
    database.prepare("UPDATE listings SET name = '' WHERE slug = 'second'").run();
    report = seoFindings();
    assert.ok(report.findings.some((row) => row.code === 'missing-title' && row.path === '/listings/second'));
    assert.ok(!report.findings.some((row) => row.code === 'duplicate-title'));
  } finally {
    database?.close();
    if (previousDatabase === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabase;
    if (previousUrl === undefined) delete process.env.SITE_URL;
    else process.env.SITE_URL = previousUrl;
    rmSync(directory, { recursive: true, force: true });
  }
});
