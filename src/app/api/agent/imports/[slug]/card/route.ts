import { canManageCatalog, sessionUser } from "@/lib/admin";
import { renderImportCard } from "@/lib/agent-cards";
import { agentPrincipal } from "@/lib/agent-keys";
import { SocialCardCapacityError } from "@/lib/social-card-cache";

export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  const user = await sessionUser(request.headers);
  if ((!user || !canManageCatalog(user.role)) &&
      !agentPrincipal(request.headers.get("authorization"))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const card = await renderImportCard((await context.params).slug, true);
    if (!card) return new Response(null, { status: 404 });
    return new Response(new Uint8Array(card.bytes), {
      headers: { "Content-Type": "image/png", "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof SocialCardCapacityError) {
      return new Response("Social card renderer is busy", { status: 503,
        headers: { "Cache-Control": "private, no-store", "Retry-After": "1" } });
    }
    throw error;
  }
}
