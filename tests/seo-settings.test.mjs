import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('site settings and content search overrides publish only with their approved revision', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'directory-seo-settings-'));
  const previousDatabase = process.env.DATABASE_URL;
  const previousUrl = process.env.SITE_URL;
  process.env.DATABASE_URL = `file:${join(directory, 'catalog.db')}`;
  process.env.SITE_URL = 'https://directory.example';
  let database;
  try {
    ({ database } = await import('../src/lib/database.ts'));
    const { migrateCatalog } = await import('../src/lib/catalog-migrations.ts');
    const { saveSeoSettings, getSeoSettings, publicSeoOverrides } = await import('../src/lib/seo-settings.ts');
    const { pageMetadata } = await import('../src/lib/page-metadata.ts');
    const { createOwnerListing, updateOwnerListing, submitOwnerListing,
      decideSubmission } = await import('../src/lib/moderation.ts');
    const { createArticle, saveArticleRevision, publishArticleRevision,
      publishedArticleBySlug } = await import('../src/lib/articles.ts');
    migrateCatalog();
    database.exec(`CREATE TABLE IF NOT EXISTS "user" (
      id TEXT PRIMARY KEY, email TEXT, role TEXT, banned INTEGER NOT NULL DEFAULT 0,
      emailVerified INTEGER NOT NULL DEFAULT 0
    )`);
    database.prepare(`INSERT INTO "user" (id, email, role, banned, emailVerified) VALUES
      ('owner', 'owner@example.invalid', 'user', 0, 1),
      ('admin', 'admin@example.invalid', 'admin', 0, 1)`).run();
    database.prepare("INSERT INTO categories (name) VALUES ('Tools')").run();
    assert.throws(() => saveSeoSettings({ titleFormat: 'No marker', description: 'Value' }, 'admin'), /format/i);
    saveSeoSettings({ titleFormat: '%s | Directory Search', description: 'Search default',
      socialImage: '/social.png', googleVerification: 'google-value', bingVerification: 'bing-value' }, 'admin');
    assert.equal(getSeoSettings().googleVerification, 'google-value');
    assert.equal(pageMetadata('/', 'Home', 'Search default').title, 'Home | Directory Search');

    const input = { slug: 'seo-listing', name: 'SEO Listing', summary: 'Summary',
      description: 'Description', category: 'Tools', url: 'https://example.org',
      seoTitle: 'First search title', seoIndexable: 'index' };
    createOwnerListing('owner', input);
    let submission = submitOwnerListing('owner', 'seo-listing');
    assert.equal(publicSeoOverrides('listing', 'seo-listing').title, null);
    decideSubmission(submission.id, 'admin', 'approve', 'Good');
    assert.equal(publicSeoOverrides('listing', 'seo-listing').title, 'First search title');
    updateOwnerListing('owner', 'seo-listing', { seoTitle: 'Private new title',
      seoIndexable: 'noindex' });
    assert.equal(publicSeoOverrides('listing', 'seo-listing').title, 'First search title');
    submission = submitOwnerListing('owner', 'seo-listing');
    assert.equal(publicSeoOverrides('listing', 'seo-listing').indexable, true);
    decideSubmission(submission.id, 'admin', 'approve', 'Good');
    const listingSeo = publicSeoOverrides('listing', 'seo-listing');
    assert.equal(listingSeo.title, 'Private new title');
    assert.equal(pageMetadata('/listings/seo-listing', 'SEO Listing', 'Summary', listingSeo).robots.index, false);

    const article = createArticle({ slug: 'seo-article', title: 'Article', summary: 'Summary',
      body: 'Body', status: 'published', tags: [], seo: { title: 'Article search title' } }, 'editor');
    assert.equal(publishedArticleBySlug('seo-article').seo.title, 'Article search title');
    const staged = saveArticleRevision('seo-article', { seo: { title: 'Staged title', indexable: false } },
      article.version, 'editor');
    assert.equal(publishedArticleBySlug('seo-article').seo.title, 'Article search title');
    publishArticleRevision('seo-article', staged.version, 'editor');
    assert.equal(publishedArticleBySlug('seo-article').seo.title, 'Staged title');
    assert.equal(publishedArticleBySlug('seo-article').seo.indexable, false);
  } finally {
    database?.close();
    if (previousDatabase === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabase;
    if (previousUrl === undefined) delete process.env.SITE_URL;
    else process.env.SITE_URL = previousUrl;
    rmSync(directory, { recursive: true, force: true });
  }
});
