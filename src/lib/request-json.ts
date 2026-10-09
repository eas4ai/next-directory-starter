export class RequestTooLargeError extends Error {}

export async function requestJson(request: Request, maxBytes = 8192): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (declaredLength > maxBytes) throw new RequestTooLargeError("Request body is too large");
  const reader = request.body?.getReader();
  if (!reader) return JSON.parse("") as unknown;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let body = "";
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
      body += decoder.decode(chunk.value, { stream: true });
    }
    body += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(body) as unknown;
}

export function requestJsonErrorResponse(error: unknown): Response {
  return error instanceof RequestTooLargeError
    ? Response.json({ error: "Request body is too large" }, { status: 413 })
    : Response.json({ error: "Invalid JSON" }, { status: 400 });
}
