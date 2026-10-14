import { canManageCatalog, sameOrigin, sessionUser } from "@/lib/admin";
import { publishAgentImport } from "@/lib/agent-imports";

export async function POST(request: Request, context: { params: Promise<{ slug: string }> }) {
  const user = await sessionUser(request.headers);
  if (!user || !canManageCatalog(user.role)) return Response.json({ error: "Forbidden" }, { status: 403 });
  if (!sameOrigin(request)) return Response.json({ error: "Invalid origin" }, { status: 403 });
  try {
    return Response.json(publishAgentImport(user.id, (await context.params).slug));
  } catch {
    return Response.json({ error: "Import cannot be published" }, { status: 404 });
  }
}
