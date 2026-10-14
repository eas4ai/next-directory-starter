import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const databaseDirectory = mkdtempSync(join(tmpdir(), 'directory-page-metadata-'));
const previousDatabaseUrl = process.env.DATABASE_URL;
process.env.DATABASE_URL = `file:${join(databaseDirectory, 'directory.db')}`;
const { pageMetadata } = await import('../src/lib/page-metadata.ts');
const { database } = await import('../src/lib/database.ts');

after(() => {
  database.close();
  if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabaseUrl;
  rmSync(databaseDirectory, { recursive: true, force: true });
});

test('SEO-002 production metadata requires a configured public origin', () => {
  const names = ['NODE_ENV', 'SITE_URL', 'NEXT_PUBLIC_SITE_URL', 'BETTER_AUTH_URL'];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    process.env.NODE_ENV = 'production';
    delete process.env.SITE_URL;
    delete process.env.NEXT_PUBLIC_SITE_URL;
    delete process.env.BETTER_AUTH_URL;
    assert.throws(() => pageMetadata('/listings', 'Listings', 'Directory links'), /SITE_URL/);

    process.env.BETTER_AUTH_URL = 'https://directory.example';
    const fallback = pageMetadata('/listings', 'Listings', 'Directory links');
    assert.equal(fallback.alternates.canonical, 'https://directory.example/listings');

    process.env.SITE_URL = 'https://public.example';
    const configured = pageMetadata('/listings', 'Listings', 'Directory links');
    assert.equal(configured.alternates.canonical, 'https://public.example/listings');
    assert.equal(configured.openGraph.url, 'https://public.example/listings');
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
});

test('SEO-012 metadata exposes only the current generated PNG directly', () => {
  const previousSiteUrl = process.env.SITE_URL;
  process.env.SITE_URL = 'https://public.example';
  try {
    const generated = pageMetadata('/listings/imported-tool', 'Imported tool', 'Description',
      undefined, { generated: '/og/listings/imported-tool.png' });
    assert.equal(generated.openGraph.images[0].url,
      'https://public.example/og/listings/imported-tool.png');
    assert.equal(generated.twitter.images[0].url,
      'https://public.example/og/listings/imported-tool.png');

    const rendered = 'https://public.example/social-card?path=%2Flistings%2Fimported-tool';
    const published = pageMetadata('/listings/imported-tool', 'Imported tool', 'Description',
      undefined, { published: '/media/12345678-1234-4234-8234-123456789abc',
        generated: '/og/listings/imported-tool.png' });
    assert.equal(published.openGraph.images[0].url, rendered);
    const overridden = pageMetadata('/listings/imported-tool', 'Imported tool', 'Description', {
      title: null, description: null, socialImage: 'https://cdn.example.org/card.webp',
      indexable: null,
    }, { generated: '/og/listings/imported-tool.png' });
    assert.equal(overridden.openGraph.images[0].url, rendered);
    const mismatched = pageMetadata('/listings/imported-tool', 'Imported tool', 'Description',
      undefined, { generated: '/og/listings/another-tool.png' });
    assert.equal(mismatched.openGraph.images[0].url, rendered);
  } finally {
    if (previousSiteUrl === undefined) delete process.env.SITE_URL;
    else process.env.SITE_URL = previousSiteUrl;
  }
});
