import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';

test('branding replacements reclaim only files no branding slot still uses', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'directory-brand-media-'));
  const previous = { DATABASE_URL: process.env.DATABASE_URL, MEDIA_DIR: process.env.MEDIA_DIR };
  process.env.DATABASE_URL = `file:${join(directory, 'catalog.db')}`;
  process.env.MEDIA_DIR = join(directory, 'media');
  let database;
  try {
    ({ database } = await import('../src/lib/database.ts'));
    const { migrateCatalog } = await import('../src/lib/catalog-migrations.ts');
    const { saveBranding, uploadBrandAsset } = await import('../src/lib/branding.ts');
    migrateCatalog();
    const bytes = await sharp({ create: { width: 6, height: 4, channels: 3,
      background: '#336699' } }).png().toBuffer();
    const pathFor = (url) => join(process.env.MEDIA_DIR, `${url.split('/').at(-1).slice(0, -5)}.webp`);

    const first = await uploadBrandAsset('logo', bytes, 'image/png', 'admin');
    const firstPath = pathFor(first.logoUrl);
    assert.equal(existsSync(firstPath), true);
    const second = await uploadBrandAsset('logo', bytes, 'image/png', 'admin');
    const secondPath = pathFor(second.logoUrl);
    assert.equal(existsSync(firstPath), false);
    assert.equal(existsSync(secondPath), true);

    saveBranding({ ...second, iconUrl: second.logoUrl }, 'admin');
    const third = await uploadBrandAsset('logo', bytes, 'image/png', 'admin');
    const thirdPath = pathFor(third.logoUrl);
    assert.equal(existsSync(secondPath), true);
    assert.equal(existsSync(thirdPath), true);

    const iconCleared = saveBranding({ ...third, iconUrl: undefined }, 'admin');
    assert.equal(existsSync(secondPath), false);
    saveBranding({ ...iconCleared, logoUrl: undefined }, 'admin');
    assert.equal(existsSync(thirdPath), false);
  } finally {
    database?.close();
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});
