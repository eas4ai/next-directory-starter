import { canManageCatalog, sameOrigin, sessionUser } from "@/lib/admin";
import { AgentImportInputError, listAgentImports, stageAgentImports } from "@/lib/agent-imports";
import { requestJson, requestJsonErrorResponse } from "@/lib/request-json";

export async function GET(request: Request) {
  const user = await sessionUser(request.headers);
  if (!user || !canManageCatalog(user.role)) return Response.json({ error: "Forbidden" }, { status: 403 });
  return Response.json({ items: listAgentImports() }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const user = await sessionUser(request.headers);
  if (!user || !canManageCatalog(user.role)) return Response.json({ error: "Forbidden" }, { status: 403 });
  if (!sameOrigin(request)) return Response.json({ error: "Invalid origin" }, { status: 403 });
  let input: unknown;
  try {
    input = await requestJson(request, 240_000);
  } catch (error) {
    const response = requestJsonErrorResponse(error);
    return response.status === 413
      ? response
      : Response.json({ error: "Invalid import batch" }, { status: 400 });
  }
  const items = typeof input === "object" && input !== null && "items" in input
    ? (input as { items: unknown }).items : null;
  try {
    return Response.json({
      items: stageAgentImports(user.id, { kind: "account", id: user.id }, items),
    }, { status: 201 });
  } catch (error) {
    if (error instanceof AgentImportInputError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    console.error("Agent import staging failed", error);
    return Response.json({ error: "Import storage failed" }, { status: 500 });
  }
}
