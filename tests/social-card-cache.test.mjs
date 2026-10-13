import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SocialCardCapacityError,
  SocialCardRenderCache,
  socialCardEntityTag,
  socialCardRevision,
} from '../src/lib/social-card-cache.ts';

const rendered = (value) => ({ bytes: Buffer.from(value), cacheable: true });

test('SEO-012 social card cache coalesces work and keeps a bounded LRU', async () => {
  const cache = new SocialCardRenderCache({
    maxEntries: 2,
    maxBytes: 12,
    maxConcurrent: 2,
    maxWaiting: 4,
  });
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let renders = 0;
  const render = async () => {
    renders += 1;
    await gate;
    return rendered('same');
  };

  const requests = Array.from({ length: 8 }, () => cache.get('same', render));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(renders, 1);
  release();
  const cards = await Promise.all(requests);
  assert.ok(cards.every((card) => card.equals(Buffer.from('same'))));
  assert.equal(await cache.get('same', async () => { throw new Error('cache miss'); }), cards[0]);

  await cache.get('second', async () => rendered('two'));
  await cache.get('third', async () => rendered('three'));
  await cache.get('same', async () => { renders += 1; return rendered('new'); });
  assert.equal(renders, 2, 'least recently used card must be evicted at the entry bound');
});

test('SEO-012 social card cache bounds active renders and queued unique work', async () => {
  const cache = new SocialCardRenderCache({
    maxEntries: 8,
    maxBytes: 1024,
    maxConcurrent: 2,
    maxWaiting: 2,
  });
  let active = 0;
  let maximumActive = 0;
  const render = async () => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise((resolve) => setTimeout(resolve, 20));
    active -= 1;
    return rendered('card');
  };

  const accepted = ['a', 'b', 'c', 'd'].map((key) => cache.get(key, render));
  await assert.rejects(cache.get('overflow', render), SocialCardCapacityError);
  await Promise.all(accepted);
  assert.equal(maximumActive, 2);
});

test('SEO-012 social card cache releases capacity after render failure', async () => {
  const cache = new SocialCardRenderCache({
    maxEntries: 2,
    maxBytes: 128,
    maxConcurrent: 1,
    maxWaiting: 0,
  });
  await assert.rejects(cache.get('broken', async () => { throw new Error('bad image'); }), /bad image/);
  const recovered = await cache.get('working', async () => rendered('ok'));
  assert.equal(recovered.toString(), 'ok');
});

test('SEO-012 social card cache retries a source after serving a generated fallback', async () => {
  const cache = new SocialCardRenderCache({
    maxEntries: 2,
    maxBytes: 128,
    maxConcurrent: 1,
    maxWaiting: 1,
  });
  let renders = 0;
  const fallback = await cache.get('published-source', async () => {
    renders += 1;
    return { bytes: Buffer.from('fallback'), cacheable: false };
  });
  assert.equal(fallback.toString(), 'fallback');
  const recovered = await cache.get('published-source', async () => {
    renders += 1;
    return { bytes: Buffer.from('published'), cacheable: true };
  });
  assert.equal(recovered.toString(), 'published');
  assert.equal(renders, 2, 'a fallback must not hide a recovered published source');
  assert.equal((await cache.get('published-source', async () => {
    throw new Error('recovered result was not cached');
  })).toString(), 'published');
});

test('SEO-012 social card revision changes with content, branding, or theme', () => {
  const base = { content: { title: 'One' }, branding: { name: 'Directory' }, theme: { id: 'preset' } };
  assert.equal(socialCardRevision('page:/', base), socialCardRevision('page:/', base));
  assert.notEqual(socialCardRevision('page:/', base),
    socialCardRevision('page:/', { ...base, content: { title: 'Two' } }));
  assert.notEqual(socialCardRevision('page:/', base),
    socialCardRevision('page:/', { ...base, branding: { name: 'Catalog' } }));
  assert.notEqual(socialCardRevision('page:/', base),
    socialCardRevision('page:/', { ...base, theme: { id: 'studio' } }));
});

test('SEO-012 social card entity tags identify the final PNG bytes', () => {
  assert.equal(socialCardEntityTag(Buffer.from('first')),
    socialCardEntityTag(Buffer.from('first')));
  assert.notEqual(socialCardEntityTag(Buffer.from('first')),
    socialCardEntityTag(Buffer.from('second')));
  assert.match(socialCardEntityTag(Buffer.from('first')), /^"[0-9a-f]{64}"$/);
});
