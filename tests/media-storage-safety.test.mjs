import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';

test('private media reclaims displaced files and persists one account limit across restart', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'directory-media-safety-'));
  const previous = { DATABASE_URL: process.env.DATABASE_URL, MEDIA_DIR: process.env.MEDIA_DIR };
  process.env.DATABASE_URL = `file:${join(directory, 'catalog.db')}`;
  process.env.MEDIA_DIR = join(directory, 'media');
  let database;
  try {
    ({ database } = await import('../src/lib/database.ts'));
    const { migrateCatalog } = await import('../src/lib/catalog-migrations.ts');
    const { uploadPrivateImage } = await import('../src/lib/media.ts');
    const { submitOwnerListing, decideSubmission } = await import('../src/lib/moderation.ts');
    migrateCatalog();
    database.prepare("INSERT INTO categories (name) VALUES ('Tools')").run();
    database.prepare(`INSERT INTO listings
      (slug, name, summary, description, category, url, status, owner_user_id)
      VALUES ('my-listing', 'Mine', 'Summary', 'Description', 'Tools',
        'https://example.org', 'draft', 'owner')`).run();
    database.prepare(`INSERT INTO articles
      (slug, title, summary, body, status, author_user_id, created_at, updated_at)
      VALUES ('my-article', 'Article', 'Summary', 'Body', 'draft', 'owner', ?, ?)`).run(
      new Date().toISOString(), new Date().toISOString());
    const bytes = await sharp({ create: { width: 4, height: 4, channels: 3,
      background: '#225588' } }).png().toBuffer();
    const request = { kind: 'listing', slug: 'my-listing', actorId: 'owner', actorRole: 'user',
      bytes, mimeType: 'image/png', alt: 'Blue square' };
    const pathFor = (id) => join(process.env.MEDIA_DIR, `${id}.webp`);
    const counts = () => ({
      assets: database.prepare('SELECT COUNT(*) AS count FROM media_assets').get().count,
      assignments: database.prepare('SELECT COUNT(*) AS count FROM media_assignments').get().count,
      pendingCleanup: database.prepare('SELECT COUNT(*) AS count FROM media_cleanup_queue').get().count,
    });

    const first = await uploadPrivateImage(request);
    const second = await uploadPrivateImage(request);
    assert.equal(existsSync(pathFor(first.id)), false);
    assert.equal(existsSync(pathFor(second.id)), true);
    assert.deepEqual(counts(), { assets: 1, assignments: 1, pendingCleanup: 0 });

    const firstReview = submitOwnerListing('owner', 'my-listing');
    decideSubmission(firstReview.id, 'moderator', 'approve', 'Good');
    const third = await uploadPrivateImage(request);
    const fourth = await uploadPrivateImage(request);
    assert.equal(existsSync(pathFor(second.id)), true);
    assert.equal(existsSync(pathFor(third.id)), false);
    assert.equal(existsSync(pathFor(fourth.id)), true);
    assert.deepEqual(counts(), { assets: 2, assignments: 2, pendingCleanup: 0 });

    const secondReview = submitOwnerListing('owner', 'my-listing');
    decideSubmission(secondReview.id, 'moderator', 'approve', 'Good revision');
    assert.equal(existsSync(pathFor(second.id)), false);
    assert.equal(existsSync(pathFor(fourth.id)), true);
    assert.deepEqual(counts(), { assets: 1, assignments: 1, pendingCleanup: 0 });

    database.prepare(`UPDATE media_upload_windows SET window_started_at = ?, accepted_count = 29
      WHERE user_id = 'owner'`).run(new Date().toISOString());
    const article = await uploadPrivateImage({ ...request, kind: 'article', slug: 'my-article',
      actorRole: 'editor' });
    assert.equal(existsSync(pathFor(article.id)), true);
    assert.equal(database.prepare(`SELECT accepted_count AS count FROM media_upload_windows
      WHERE user_id = 'owner'`).get().count, 30);

    const abandonedId = randomUUID();
    const abandonedFile = pathFor(abandonedId);
    writeFileSync(abandonedFile, 'abandoned');
    database.prepare(`INSERT INTO media_cleanup_queue (asset_id, queued_at) VALUES (?, ?)`)
      .run(abandonedId, new Date().toISOString());
    database.close();
    database = undefined;

    const child = spawnSync(process.execPath,
      ['--import', 'tsx', 'tests/fixtures/media-rate-restart.mjs'], {
        cwd: process.cwd(), encoding: 'utf8', timeout: 30_000,
        env: { ...process.env, TEST_IMAGE_BASE64: bytes.toString('base64') },
      });
    assert.equal(child.status, 0, child.stderr || child.stdout);
    assert.ok(child.stdout.trim(), JSON.stringify({
      status: child.status, signal: child.signal, error: child.error?.message,
      stdout: child.stdout, stderr: child.stderr,
    }));
    const result = JSON.parse(child.stdout.trim().split('\n').at(-1));
    assert.deepEqual(result, {
      status: 429,
      message: 'Private image upload limit reached; try again later',
      assets: 2,
      pendingCleanup: 0,
      accepted: 30,
    });
    assert.equal(existsSync(abandonedFile), false);
    assert.equal(readdirSync(process.env.MEDIA_DIR).filter((name) => name.endsWith('.webp')).length, 2);
  } finally {
    database?.close();
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});
