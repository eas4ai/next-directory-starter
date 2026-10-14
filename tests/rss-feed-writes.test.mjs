import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('RSS feed rows release the shared database before response streaming', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'directory-rss-feed-'));
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = `file:${join(directory, 'catalog.db')}`;
  let database;
  let feedIterator;
  try {
    ({ database } = await import('../src/lib/database.ts'));
    const { migrateCatalog } = await import('../src/lib/catalog-migrations.ts');
    const { createArticle, publishedArticleFeedRows } = await import('../src/lib/articles.ts');
    migrateCatalog();
    createArticle({ slug: 'first', title: 'First', summary: 'First summary',
      body: 'First body', status: 'published', category: null, tags: [] }, 'editor');

    const feedRows = publishedArticleFeedRows();
    feedIterator = feedRows[Symbol.iterator]();
    assert.equal(feedIterator.next().value?.slug, 'first');

    assert.doesNotThrow(() => createArticle({ slug: 'while-streaming', title: 'While streaming',
      summary: 'A write made after streaming starts', body: 'New body', status: 'draft',
      category: null, tags: [] }, 'editor'));
  } finally {
    feedIterator?.return?.();
    database?.close();
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});
