import { createServer } from 'node:http';

export async function startAccountMail() {
  const messages = [];
  const server = createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/emails' ||
        request.headers.authorization !== 'Bearer test-resend-key') {
      response.writeHead(404).end();
      return;
    }
    let body = '';
    for await (const chunk of request) body += chunk.toString('utf8');
    const email = JSON.parse(body);
    messages.push({ to: String(email.to?.[0]).toLowerCase(), text: String(email.text ?? '') });
    response.writeHead(200, { 'Content-Type': 'application/json' })
      .end(JSON.stringify({ id: `test-${messages.length}` }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    env: {
      RESEND_API_KEY: 'test-resend-key',
      RESEND_FROM: 'Directory test <mail@test.local>',
      RESEND_API_BASE_URL: `http://127.0.0.1:${server.address().port}`,
    },
    count: () => messages.length,
    async link(address, since) {
      for (let attempt = 0; attempt < 60; attempt += 1) {
        const message = messages.slice(since).find((item) => item.to === address.toLowerCase());
        if (message) {
          const url = message.text.match(/https?:\/\/[^\s<>"']+/)?.[0];
          if (url) return url;
          throw new Error('Account email arrived without a link.');
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error(`No account email arrived for ${address}.`);
    },
    async close() { await new Promise((resolve) => server.close(resolve)); },
  };
}
