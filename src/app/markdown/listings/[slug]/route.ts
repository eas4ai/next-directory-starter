import { connection } from "next/server";
import { publishedListingBySlug } from "@/lib/listings";
import { listingMarkdown, markdownHeaders } from "@/lib/markdown-twins";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  await connection();
  const listing = publishedListingBySlug((await params).slug);
  if (!listing) return new Response("Not Found", { status: 404, headers: markdownHeaders });
  return new Response(listingMarkdown(listing), { headers: markdownHeaders });
}
