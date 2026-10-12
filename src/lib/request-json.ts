export class RequestTooLargeError extends Error {}

async function requestBytes(request: Request, maxBytes: number): Promise<Uint8Array<ArrayBuffer>> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (declaredLength > maxBytes) {
    await request.body?.cancel();
    throw new RequestTooLargeError("Request body is too large");
  }
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw new RequestTooLargeError("Request body is too large");
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function requestJson(request: Request, maxBytes = 8192): Promise<unknown> {
  const bytes = await requestBytes(request, maxBytes);
  const body = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  return JSON.parse(body) as unknown;
}

export async function requestWithBodyLimit(request: Request, maxBytes: number): Promise<Request> {
  const body = await requestBytes(request, maxBytes);
  return new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body,
    signal: request.signal,
  });
}

export function requestJsonErrorResponse(error: unknown): Response {
  return error instanceof RequestTooLargeError
    ? Response.json({ error: "Request body is too large" }, { status: 413 })
    : Response.json({ error: "Invalid JSON" }, { status: 400 });
}
