import { createServer } from 'node:http';

const port = Number(process.argv.at(-1));
createServer((request, response) => {
  if (request.url === '/listings') {
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end('<html><head><title>Directory</title></head><body><main>Hidden Draft</main></body></html>');
  } else if (request.url === '/listings/example-tool') {
    response.writeHead(404);
    response.end('missing');
  } else {
    response.writeHead(200);
    response.end('ready');
  }
}).listen(port, '127.0.0.1');
