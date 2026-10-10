import { renderSocialCard } from "@/lib/social-cards";

export async function GET(request: Request) {
  const path = new URL(request.url).searchParams.get("path") ?? "";
  const card = await renderSocialCard(path);
  if (!card) return new Response("Not Found", { status: 404,
    headers: { "Cache-Control": "no-store" } });
  return new Response(new Uint8Array(card), { headers: {
    "Content-Type": "image/png", "Content-Length": String(card.length),
    "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
  } });
}
