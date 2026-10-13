import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  RequestTooLargeError,
  requestJson,
  requestText,
  requestWithBodyLimit,
} from '../src/lib/request-json.ts';

function streamedRequest(chunks, headers = {}) {
  const state = { cancelled: false, pulls: 0 };
  const body = new ReadableStream({
    pull(controller) {
      const chunk = chunks[state.pulls];
      state.pulls += 1;
      if (chunk) controller.enqueue(chunk);
      else controller.close();
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return {
    request: new Request('http://localhost/api/example?kept=yes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Test': 'preserved', ...headers },
      body,
      duplex: 'half',
    }),
    state,
  };
}

test('requestJson enforces transport bytes and cancels before later chunks are read', async () => {
  const encoder = new TextEncoder();
  const { request, state } = streamedRequest([
    encoder.encode('{"x"'),
    encoder.encode(':"€"}'),
    encoder.encode('unread'),
  ]);

  await assert.rejects(requestJson(request, 7), RequestTooLargeError);
  assert.equal(state.cancelled, true);
  assert.equal(state.pulls, 2);
});

test('requestWithBodyLimit preserves request metadata and exact body bytes', async () => {
  const encoder = new TextEncoder();
  const { request } = streamedRequest([encoder.encode('{"ok":'), encoder.encode('true}')]);

  const bounded = await requestWithBodyLimit(request, 64);

  assert.equal(bounded.url, 'http://localhost/api/example?kept=yes');
  assert.equal(bounded.method, 'POST');
  assert.equal(bounded.headers.get('x-test'), 'preserved');
  assert.deepEqual(await bounded.json(), { ok: true });
});

test('requestText preserves signed payload bytes as text within the cap', async () => {
  const encoder = new TextEncoder();
  const { request } = streamedRequest([encoder.encode('{"currency":"€"}')]);

  assert.equal(await requestText(request, 64), '{"currency":"€"}');
});

test('requestWithBodyLimit rejects a declared oversized body and cancels it', async () => {
  const encoder = new TextEncoder();
  const { request, state } = streamedRequest([encoder.encode('{}')], { 'Content-Length': '65' });

  await assert.rejects(requestWithBodyLimit(request, 64), RequestTooLargeError);
  assert.equal(state.cancelled, true);
});

test('Better Auth rejects an oversized body before dispatch', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'directory-request-body-limit-'));
  const names = ['DATABASE_URL', 'BETTER_AUTH_SECRET', 'BETTER_AUTH_URL', 'SITE_URL'];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  process.env.DATABASE_URL = `file:${join(directory, 'directory.db')}`;
  process.env.BETTER_AUTH_SECRET = 'request-body-limit-test-secret-that-is-long-enough';
  process.env.BETTER_AUTH_URL = 'http://localhost';
  process.env.SITE_URL = 'http://localhost';
  let database;
  try {
    ({ database } = await import('../src/lib/database.ts'));
    const { POST } = await import('../src/app/api/auth/[...all]/route.ts');
    const request = new Request('http://localhost/api/auth/sign-in/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': String(64 * 1024 + 1),
      },
      body: '{}',
    });

    const response = await POST(request);

    assert.equal(response.status, 413);
    assert.deepEqual(await response.json(), { error: 'Request body is too large' });
  } finally {
    database?.close();
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
    rmSync(directory, { recursive: true, force: true });
  }
});
