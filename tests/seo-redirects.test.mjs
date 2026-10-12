import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('redirects reject unsafe routes and slug changes retain a safe old address', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'directory-seo-redirects-'));
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = `file:${join(directory, 'catalog.db')}`;
  let database;
  try {
    ({ database } = await import('../src/lib/database.ts'));
    const { migrateCatalog } = await import('../src/lib/catalog-migrations.ts');
    const { saveRedirect, redirectForPath, recordNotFound, listNotFound } =
      await import('../src/lib/seo-redirects.ts');
    const { createArticle, renameArticle, publishedArticleBySlug } =
      await import('../src/lib/articles.ts');
    migrateCatalog();
    database.prepare("INSERT INTO tags (name) VALUES ('Guides')").run();
    const old = createArticle({ slug: 'old-article', title: 'Old article', summary: 'Summary',
      body: 'Body', status: 'published', tags: ['Guides'], seo: { title: 'Search title' } }, 'editor');
    assert.throws(() => saveRedirect('/articles/old-article', '/articles/new-article', 'admin'), /shadow/i);
    assert.throws(() => saveRedirect('/old', 'https://outside.invalid/', 'admin'), /path/i);
    saveRedirect('/older', '/old', 'admin');
    assert.throws(() => saveRedirect('/old', '/older', 'admin'), /cycle/i);
    const renamed = renameArticle('old-article', 'new-article', old.version, 'editor');
    assert.equal(renamed.slug, 'new-article');
    assert.equal(publishedArticleBySlug('old-article'), undefined);
    assert.deepEqual(publishedArticleBySlug('new-article').tags, ['Guides']);
    assert.equal(publishedArticleBySlug('new-article').seo.title, 'Search title');
    assert.equal(redirectForPath('/articles/old-article'), '/articles/new-article');
    assert.throws(() => renameArticle('new-article', 'third-article', old.version, 'editor'), /changed/i);
    recordNotFound('/missing-page');
    recordNotFound('/missing-page', 'same-request');
    recordNotFound('/missing-page', 'same-request');
    recordNotFound('/private?token=secret');
    assert.equal(listNotFound().find((row) => row.path === '/missing-page').hits, 2);
    assert.ok(!JSON.stringify(listNotFound()).includes('secret'));
  } finally {
    database?.close();
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});
