import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

test('Markdown renders formatting but never active HTML, script URLs, or images', async () => {
  const { MarkdownContent } = await import('../src/components/markdown-content.tsx');
  const markup = renderToStaticMarkup(createElement(MarkdownContent, {
    source: '**Bold** [safe](https://example.com) [unsafe](javascript:alert(1)) <script>alert(2)</script> ![remote](https://example.com/tracker.png)',
  }));
  assert.match(markup, /<strong>Bold<\/strong>/);
  assert.match(markup, /href="https:\/\/example.com"/);
  assert.doesNotMatch(markup, /<script|javascript:|<img|tracker\.png/i);
});

test('published edits stay private until explicit publication and stale saves fail', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'directory-article-revision-'));
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = `file:${join(directory, 'catalog.db')}`;
  let database;
  try {
    ({ database } = await import('../src/lib/database.ts'));
    const { migrateCatalog } = await import('../src/lib/catalog-migrations.ts');
    const { createArticle, editableArticleBySlug, publishedArticleBySlug,
      saveArticleRevision, publishArticleRevision } = await import('../src/lib/articles.ts');
    migrateCatalog();
    const article = createArticle({ slug: 'revised', title: 'Old title', summary: 'Old summary',
      body: 'Old **body**', status: 'published', tags: [] }, 'editor');
    const saved = saveArticleRevision('revised', { title: 'New title', summary: 'New summary',
      body: 'New **body**', tags: [] }, article.version, 'editor');
    assert.equal(editableArticleBySlug('revised')?.body, 'New **body**');
    assert.equal(publishedArticleBySlug('revised')?.body, 'Old **body**');
    assert.throws(() => saveArticleRevision('revised', { title: 'Stale', summary: 'Stale',
      body: 'Stale', tags: [] }, article.version, 'editor'), /stale|changed|conflict/i);
    publishArticleRevision('revised', saved.version, 'editor');
    assert.equal(publishedArticleBySlug('revised')?.body, 'New **body**');
    assert.equal(publishedArticleBySlug('revised')?.title, 'New title');
  } finally {
    database?.close();
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});
