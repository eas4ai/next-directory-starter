import { connection } from "next/server";
import { publishedArticleBySlug } from "@/lib/articles";
import { articleMarkdown, markdownHeaders } from "@/lib/markdown-twins";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  await connection();
  const article = publishedArticleBySlug((await params).slug);
  if (!article) return new Response("Not Found", { status: 404, headers: markdownHeaders });
  return new Response(articleMarkdown(article), { headers: markdownHeaders });
}
