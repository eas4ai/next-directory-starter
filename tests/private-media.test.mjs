import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';

test('private upload bounds, decodes, re-encodes, authorizes, and persists images', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'directory-private-media-'));
  const previous = { DATABASE_URL: process.env.DATABASE_URL, MEDIA_DIR: process.env.MEDIA_DIR };
  process.env.DATABASE_URL = `file:${join(directory, 'catalog.db')}`;
  process.env.MEDIA_DIR = join(directory, 'media');
  let database;
  try {
    ({ database } = await import('../src/lib/database.ts'));
    const { migrateCatalog } = await import('../src/lib/catalog-migrations.ts');
    const { uploadPrivateImage } = await import('../src/lib/media.ts');
    migrateCatalog();
    database.prepare("INSERT INTO categories (name) VALUES ('Tools')").run();
    database.prepare(`INSERT INTO listings
      (slug, name, summary, description, category, url, status, owner_user_id)
      VALUES ('my-listing', 'Mine', 'Summary', 'Description', 'Tools', 'https://example.org', 'draft', 'owner')`).run();
    database.prepare(`INSERT INTO articles
      (slug, title, summary, body, status, author_user_id, created_at, updated_at)
      VALUES ('my-article', 'Article', 'Summary', 'Body', 'draft', 'editor', ?, ?)`)
      .run(new Date().toISOString(), new Date().toISOString());
    const image = await sharp({ create: { width: 12, height: 8, channels: 3,
      background: '#ff8833' } }).jpeg().withExif({ IFD0: { Copyright: 'private-marker' } }).toBuffer();
    const request = { kind: 'listing', slug: 'my-listing', actorId: 'owner', actorRole: 'user',
      bytes: image, mimeType: 'image/jpeg', alt: 'Orange sample' };
    const before = database.prepare("SELECT COUNT(*) AS count FROM media_assets").get().count;
    const listingRevision = database.prepare(
      "SELECT revision FROM listings WHERE slug = 'my-listing'",
    ).get().revision;
    const articleRevision = database.prepare(
      "SELECT revision FROM articles WHERE slug = 'my-article'",
    ).get().revision;
    await assert.rejects(uploadPrivateImage({ ...request, actorId: 'intruder' }), /not found|forbidden/i);
    await assert.rejects(uploadPrivateImage({ ...request, mimeType: 'image/svg+xml' }), /format|type|image/i);
    await assert.rejects(uploadPrivateImage({ ...request, bytes: Buffer.from('<svg/>'), mimeType: 'image/jpeg' }), /format|image|invalid/i);
    await assert.rejects(uploadPrivateImage({ ...request, bytes: Buffer.alloc(5 * 1024 * 1024 + 1) }), /large|size|limit/i);
    const tooWide = await sharp({ create: { width: 4097, height: 1, channels: 3,
      background: '#fff' } }).png().toBuffer();
    await assert.rejects(uploadPrivateImage({ ...request, bytes: tooWide, mimeType: 'image/png' }), /dimension|pixel|large/i);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM media_assets").get().count, before);
    assert.equal(database.prepare(
      "SELECT revision FROM listings WHERE slug = 'my-listing'",
    ).get().revision, listingRevision);

    const articleRequest = { ...request, kind: 'article', slug: 'my-article',
      actorId: 'editor', actorRole: 'editor' };
    await assert.rejects(uploadPrivateImage({ ...articleRequest,
      bytes: Buffer.from('<svg/>'), mimeType: 'image/jpeg' }), /format|image|invalid/i);
    assert.equal(database.prepare(
      "SELECT revision FROM articles WHERE slug = 'my-article'",
    ).get().revision, articleRevision);

    const stored = await uploadPrivateImage(request);
    const file = join(process.env.MEDIA_DIR, `${stored.id}.webp`);
    assert.equal(existsSync(file), true);
    assert.equal(stored.alt, 'Orange sample');
    const bytes = readFileSync(file);
    assert.equal(bytes.includes(Buffer.from('private-marker')), false);
    const metadata = await sharp(bytes).metadata();
    assert.equal(metadata.format, 'webp');
    assert.equal(metadata.exif, undefined);
    assert.equal(metadata.width, 12);
    assert.equal(metadata.height, 8);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM media_assets").get().count, before + 1);

    let restartAsset = stored;
    for (const [mimeType, format] of [['image/png', 'png'], ['image/webp', 'webp']]) {
      const accepted = await sharp({ create: { width: 3, height: 3, channels: 4,
        background: '#55aaff' } }).toFormat(format).toBuffer();
      const asset = await uploadPrivateImage({ ...request, bytes: accepted, mimeType });
      restartAsset = asset;
      assert.equal((await sharp(readFileSync(join(process.env.MEDIA_DIR, `${asset.id}.webp`)))
        .metadata()).format, 'webp');
    }

    const articleImage = await uploadPrivateImage(articleRequest);
    assert.equal(existsSync(join(process.env.MEDIA_DIR, `${articleImage.id}.webp`)), true);
    assert.equal(database.prepare("SELECT revision FROM articles WHERE slug = 'my-article'").get().revision, 2);

    database.close();
    database = undefined;
    const child = spawnSync(process.execPath,
      ['--import', 'tsx', 'tests/fixtures/private-media-restart.mjs'], {
        cwd: process.cwd(), encoding: 'utf8', timeout: 30_000,
        env: { ...process.env, TEST_ASSET_ID: restartAsset.id },
      });
    assert.equal(child.status, 0, child.stderr || child.stdout || child.error?.message);
    assert.deepEqual(JSON.parse(child.stdout.trim().split('\n').at(-1)), {
      id: restartAsset.id,
      kind: 'listing',
      slug: 'my-listing',
      format: 'webp',
      width: 3,
      height: 3,
    });
  } finally {
    database?.close();
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});
