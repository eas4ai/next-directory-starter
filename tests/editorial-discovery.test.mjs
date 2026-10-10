import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('article discovery is published-only, filtered, bounded, and has independent categories', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'directory-article-discovery-'));
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = `file:${join(directory, 'catalog.db')}`;
  let database;
  try {
    ({ database } = await import('../src/lib/database.ts'));
    const { migrateCatalog } = await import('../src/lib/catalog-migrations.ts');
    const { createArticle, searchPublishedArticles } = await import('../src/lib/articles.ts');
    const { createTaxon, renameTaxon, deleteTaxon, listTaxa } = await import('../src/lib/taxonomy.ts');
    migrateCatalog();
    createTaxon('article-category', 'News');
    createTaxon('article-category', 'Guides');
    createTaxon('tag', 'Launch');
    assert.equal(listTaxa('category').some((item) => item.name === 'News'), false);
    for (let index = 0; index < 25; index += 1) {
      createArticle({ slug: `news-${index}`, title: `Launch ${index}`, summary: 'A release',
        body: 'A searchable body', status: 'published', category: 'News', tags: ['Launch'] }, 'editor');
    }
    createArticle({ slug: 'private-news', title: 'Launch private', summary: 'Secret',
      body: 'A searchable body', status: 'draft', category: 'News', tags: ['Launch'] }, 'editor');
    createArticle({ slug: 'guide', title: 'Guide', summary: 'Other topic',
      body: 'Guide body', status: 'published', category: 'Guides', tags: [] }, 'editor');

    const first = searchPublishedArticles({ query: 'Launch', category: 'News', tag: 'Launch', page: 1 });
    const second = searchPublishedArticles({ query: 'Launch', category: 'News', tag: 'Launch', page: 2 });
    assert.equal(first.articles.length, 20);
    assert.equal(second.articles.length, 5);
    assert.equal(first.pages, 2);
    assert.equal(new Set([...first.articles, ...second.articles].map((article) => article.slug)).size, 25);
    assert.equal([...first.articles, ...second.articles].some((article) => article.slug === 'private-news'), false);
    assert.equal(searchPublishedArticles({ query: 'Launch', category: 'Guides', page: 1 }).articles.length, 0);
    assert.equal(searchPublishedArticles({ tag: 'Launch', page: 10_000 }).page, 2);

    assert.throws(() => deleteTaxon('article-category', 'News'), /use|content|referenc/i);
    renameTaxon('article-category', 'News', 'Updates');
    assert.equal(searchPublishedArticles({ category: 'News', page: 1 }).articles.length, 0);
    assert.equal(searchPublishedArticles({ category: 'Updates', page: 1 }).articles.length, 20);
    assert.equal(listTaxa('category').some((item) => item.name === 'Updates'), false);
  } finally {
    database?.close();
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});
