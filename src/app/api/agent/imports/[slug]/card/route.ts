import { canManageCatalog, sessionUser } from "@/lib/admin";
import { renderImportCard } from "@/lib/agent-cards";

export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  const user = await sessionUser(request.headers);
  if (!user || !canManageCatalog(user.role)) return Response.json({ error: "Forbidden" }, { status: 403 });
  const card = await renderImportCard((await context.params).slug, true);
  if (!card) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(card), {
    headers: { "Content-Type": "image/png", "Cache-Control": "private, no-store" },
  });
}
