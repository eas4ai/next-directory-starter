import test from 'node:test';
import assert from 'node:assert/strict';
import { pageMetadata } from '../src/lib/page-metadata.ts';

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
