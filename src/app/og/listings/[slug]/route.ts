import { renderImportCard } from "@/lib/agent-cards";

const uncached = { "Cache-Control": "no-store" };

export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }) {
  const filename = (await context.params).slug;
  if (!filename.endsWith(".png")) return new Response(null, { status: 404, headers: uncached });
  const slug = filename.slice(0, -4);
  const card = await renderImportCard(slug, false);
  if (!card) return new Response(null, { status: 404, headers: uncached });
  return new Response(new Uint8Array(card), {
    headers: { "Content-Type": "image/png", ...uncached },
  });
}
