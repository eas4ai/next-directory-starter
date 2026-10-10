import { canManageCatalog, sameOrigin, sessionUser } from "@/lib/admin";
import { issueAgentKey, listAgentKeys } from "@/lib/agent-keys";

export async function GET(request: Request) {
  const user = await sessionUser(request.headers);
  if (!user || !canManageCatalog(user.role)) return Response.json({ error: "Forbidden" }, { status: 403 });
  return Response.json({ keys: listAgentKeys(user.id) });
}

export async function POST(request: Request) {
  const user = await sessionUser(request.headers);
  if (!user || !canManageCatalog(user.role)) return Response.json({ error: "Forbidden" }, { status: 403 });
  if (!sameOrigin(request)) return Response.json({ error: "Invalid origin" }, { status: 403 });
  let input: Record<string, unknown>;
  try {
    const text = await request.text();
    if (text.length > 2048) throw new Error("Request is too large");
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid input");
    input = value as Record<string, unknown>;
    return Response.json(issueAgentKey(user.id, input.name, input.expiresInDays), { status: 201,
      headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Invalid key request" }, { status: 400 });
  }
}
