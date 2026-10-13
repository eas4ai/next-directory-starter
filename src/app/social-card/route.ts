import { renderSocialCard } from "@/lib/social-cards";
import { SocialCardCapacityError } from "@/lib/social-card-cache";

const cacheControl = "public, max-age=0, must-revalidate";

export async function GET(request: Request) {
  const path = new URL(request.url).searchParams.get("path") ?? "";
  try {
    const card = await renderSocialCard(path);
    if (!card) return new Response("Not Found", { status: 404,
      headers: { "Cache-Control": "no-store" } });
    const etag = `"${card.revision}"`;
    const headers = { "Cache-Control": cacheControl, ETag: etag,
      "X-Content-Type-Options": "nosniff" };
    if (request.headers.get("if-none-match")?.split(",").map((value) => value.trim())
        .some((value) => value === etag || value === "*")) {
      return new Response(null, { status: 304, headers });
    }
    return new Response(new Uint8Array(card.bytes), { headers: {
      ...headers, "Content-Type": "image/png", "Content-Length": String(card.bytes.length),
    } });
  } catch (error) {
    if (error instanceof SocialCardCapacityError) {
      return new Response("Social card renderer is busy", { status: 503,
        headers: { "Cache-Control": "no-store", "Retry-After": "1" } });
    }
    throw error;
  }
}
