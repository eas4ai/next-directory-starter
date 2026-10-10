import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';

test('draft images stay private and public images follow approved content state', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'directory-media-visibility-'));
  const previous = { DATABASE_URL: process.env.DATABASE_URL, MEDIA_DIR: process.env.MEDIA_DIR };
  process.env.DATABASE_URL = `file:${join(directory, 'catalog.db')}`;
  process.env.MEDIA_DIR = join(directory, 'media');
  let database;
  try {
    ({ database } = await import('../src/lib/database.ts'));
    const { migrateCatalog } = await import('../src/lib/catalog-migrations.ts');
    const { uploadPrivateImage, privateMediaAsset, publicMediaAsset } = await import('../src/lib/media.ts');
    const { mediaFileResponse } = await import('../src/lib/media-routes.ts');
    const { createOwnerListing, submitOwnerListing, decideSubmission,
      suspendPublishedListing } = await import('../src/lib/moderation.ts');
    const { articleBySlug, createArticle, publishArticleRevision,
      updateArticle } = await import('../src/lib/articles.ts');
    migrateCatalog();
    database.exec('CREATE TABLE IF NOT EXISTS "user" (id TEXT PRIMARY KEY, banned INTEGER NOT NULL DEFAULT 0)');
    database.prepare("INSERT INTO \"user\" (id, banned) VALUES ('owner', 0)").run();
    database.prepare("INSERT INTO categories (name) VALUES ('Tools')").run();
    createOwnerListing('owner', { slug: 'my-listing', name: 'Mine', summary: 'Summary',
      description: 'Description', category: 'Tools', url: 'https://example.org' });
    const bytes = await sharp({ create: { width: 4, height: 4, channels: 3,
      background: '#8844cc' } }).png().toBuffer();
    const listingUpload = { kind: 'listing', slug: 'my-listing', actorId: 'owner',
      actorRole: 'user', bytes, mimeType: 'image/png', alt: 'Purple square' };
    const first = await uploadPrivateImage(listingUpload);
    assert.equal(publicMediaAsset(first.id), undefined);
    assert.throws(() => privateMediaAsset(first.id, 'stranger', 'user'), /forbidden|not found/i);
    assert.equal(privateMediaAsset(first.id, 'owner', 'user').id, first.id);
    const firstReview = submitOwnerListing('owner', 'my-listing');
    decideSubmission(firstReview.id, 'moderator', 'approve', 'Good');
    assert.equal(publicMediaAsset(first.id)?.id, first.id);
    const publicResponse = await mediaFileResponse(publicMediaAsset(first.id));
    assert.equal(publicResponse.status, 200);
    assert.equal(publicResponse.headers.get('content-type'), 'image/webp');
    assert.equal(publicResponse.headers.get('cache-control'), 'no-store');
    assert.equal((await sharp(Buffer.from(await publicResponse.arrayBuffer())).metadata()).format, 'webp');

    const second = await uploadPrivateImage(listingUpload);
    assert.equal(publicMediaAsset(first.id)?.id, first.id);
    assert.equal(publicMediaAsset(second.id), undefined);
    const secondReview = submitOwnerListing('owner', 'my-listing');
    decideSubmission(secondReview.id, 'moderator', 'approve', 'Good revision');
    assert.equal(publicMediaAsset(first.id), undefined);
    assert.equal(publicMediaAsset(second.id)?.id, second.id);
    suspendPublishedListing('my-listing', 'moderator', 'Policy');
    assert.equal(publicMediaAsset(second.id), undefined);

    const article = createArticle({ slug: 'story', title: 'Story', summary: 'Summary',
      body: 'Body', status: 'draft', tags: [] }, 'editor');
    const articleUpload = { ...listingUpload, kind: 'article', slug: 'story',
      actorId: 'editor', actorRole: 'editor' };
    const draft = await uploadPrivateImage(articleUpload);
    assert.equal(publicMediaAsset(draft.id), undefined);
    assert.throws(() => privateMediaAsset(draft.id, 'stranger', 'user'), /forbidden|not found/i);
    publishArticleRevision('story', article.version + 1, 'editor');
    assert.equal(publicMediaAsset(draft.id)?.id, draft.id);
    const revised = await uploadPrivateImage(articleUpload);
    assert.equal(publicMediaAsset(draft.id)?.id, draft.id);
    assert.equal(publicMediaAsset(revised.id), undefined);
    publishArticleRevision('story', articleBySlug('story').version, 'editor');
    assert.equal(publicMediaAsset(draft.id), undefined);
    assert.equal(publicMediaAsset(revised.id)?.id, revised.id);
    updateArticle('story', { status: 'draft' }, 'editor');
    assert.equal(publicMediaAsset(revised.id), undefined);
  } finally {
    database?.close();
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});
