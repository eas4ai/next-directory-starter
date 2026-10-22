import { canManageCatalog, sameOrigin, sessionUser } from "@/lib/admin";
import { revokeAgentKey } from "@/lib/agent-keys";

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await sessionUser(request.headers);
  if (!user || !canManageCatalog(user.role)) return Response.json({ error: "Forbidden" }, { status: 403 });
  if (!sameOrigin(request)) return Response.json({ error: "Invalid origin" }, { status: 403 });
  const { id } = await context.params;
  return revokeAgentKey(user.id, id)
    ? new Response(null, { status: 204 })
    : Response.json({ error: "Key not found" }, { status: 404 });
}
