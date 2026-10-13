import { renderImportCard } from "@/lib/agent-cards";
import { SocialCardCapacityError } from "@/lib/social-card-cache";

const uncached = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const cacheControl = "public, max-age=0, must-revalidate";

export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  const filename = (await context.params).slug;
  if (!filename.endsWith(".png")) return new Response(null, { status: 404, headers: uncached });
  const slug = filename.slice(0, -4);
  try {
    const card = await renderImportCard(slug, false);
    if (!card) return new Response(null, { status: 404, headers: uncached });
    const etag = card.etag;
    const headers = { "Cache-Control": cacheControl, ETag: etag,
      "X-Content-Type-Options": "nosniff" };
    if (request.headers.get("if-none-match")?.split(",").map((value) => value.trim())
        .some((value) => value === etag || value === "*")) {
      return new Response(null, { status: 304, headers });
    }
    return new Response(new Uint8Array(card.bytes), {
      headers: { ...headers, "Content-Type": "image/png",
        "Content-Length": String(card.bytes.length) },
    });
  } catch (error) {
    if (error instanceof SocialCardCapacityError) {
      return new Response("Social card renderer is busy", { status: 503,
        headers: { ...uncached, "Retry-After": "1" } });
    }
    throw error;
  }
}
