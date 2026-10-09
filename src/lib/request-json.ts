export async function requestJson(request: Request): Promise<unknown> {
  const body = await request.text();
  if (body.length > 8192) throw new Error("Request body is too large");
  return JSON.parse(body) as unknown;
}
