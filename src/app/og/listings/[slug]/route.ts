import { renderImportCard } from "@/lib/agent-cards";

export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }) {
  const filename = (await context.params).slug;
  if (!filename.endsWith(".png")) return new Response(null, { status: 404 });
  const slug = filename.slice(0, -4);
  const card = await renderImportCard(slug, false);
  if (!card) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(card), {
    headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=60" },
  });
}
