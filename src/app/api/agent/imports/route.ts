import { canManageCatalog, sameOrigin, sessionUser } from "@/lib/admin";
import { listAgentImports, stageAgentImports } from "@/lib/agent-imports";

export async function GET(request: Request) {
  const user = await sessionUser(request.headers);
  if (!user || !canManageCatalog(user.role)) return Response.json({ error: "Forbidden" }, { status: 403 });
  return Response.json({ items: listAgentImports() }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const user = await sessionUser(request.headers);
  if (!user || !canManageCatalog(user.role)) return Response.json({ error: "Forbidden" }, { status: 403 });
  if (!sameOrigin(request)) return Response.json({ error: "Invalid origin" }, { status: 403 });
  try {
    const body = await request.text();
    if (body.length > 240_000) throw new Error("Request is too large");
    const input: unknown = JSON.parse(body);
    const items = typeof input === "object" && input !== null && "items" in input
      ? (input as { items: unknown }).items : null;
    return Response.json({ items: stageAgentImports(user.id, items) }, { status: 201 });
  } catch {
    return Response.json({ error: "Invalid import batch" }, { status: 400 });
  }
}
