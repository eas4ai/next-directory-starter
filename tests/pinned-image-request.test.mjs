import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import sharp from 'sharp';
import { requestPinnedImage } from '../src/lib/pinned-image-request.ts';

test('a pinned public-image request connects with its selected address family', async () => {
  const pixels = await sharp({ create: { width: 2, height: 2, channels: 3,
    background: '#f43f5e' } }).png().toBuffer();
  const server = createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'image/png' });
    response.end(pixels);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = new URL(`http://image.example.invalid:${server.address().port}/image.png`);
    const received = await requestPinnedImage(url, { address: '127.0.0.1', family: 4 });
    assert.deepEqual(received, pixels);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
