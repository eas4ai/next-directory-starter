import { canManageCatalog, sameOrigin, sessionUser } from "@/lib/admin";
import { issueAgentKey, listAgentKeys } from "@/lib/agent-keys";
import { requestJson, requestJsonErrorResponse } from "@/lib/request-json";

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
    const value = await requestJson(request, 2048);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid input");
    input = value as Record<string, unknown>;
  } catch (error) {
    const response = requestJsonErrorResponse(error);
    return response.status === 413
      ? response
      : Response.json({ error: "Invalid key request" }, { status: 400 });
  }
  try {
    return Response.json(issueAgentKey(user.id, input.name, input.expiresInDays), { status: 201,
      headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Invalid key request" }, { status: 400 });
  }
}
