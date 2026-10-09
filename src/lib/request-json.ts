export class RequestTooLargeError extends Error {}

export async function requestJson(request: Request, maxLength = 8192): Promise<unknown> {
  const body = await request.text();
  if (body.length > maxLength) throw new RequestTooLargeError("Request body is too large");
  return JSON.parse(body) as unknown;
}

export function requestJsonErrorResponse(error: unknown): Response {
  return error instanceof RequestTooLargeError
    ? Response.json({ error: "Request body is too large" }, { status: 413 })
    : Response.json({ error: "Invalid JSON" }, { status: 400 });
}
