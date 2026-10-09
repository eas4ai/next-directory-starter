import { publishedArticleFeedRows } from "@/lib/articles";
import { publicUrl } from "@/lib/page-metadata";
import { getSiteConfig } from "@/lib/site-config";
import { connection } from "next/server";

function xml(value: string): string {
  const valid = Array.from(value, (character) => {
    const point = character.codePointAt(0)!;
    return point === 9 || point === 10 || point === 13 ||
      (point >= 32 && point <= 0xd7ff) ||
      (point >= 0xe000 && point <= 0xfffd) ||
      (point >= 0x10000 && point <= 0x10ffff) ? character : "";
  }).join("");
  return valid
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function* feedChunks(): Generator<string> {
  const site = getSiteConfig();
  yield '<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel>';
  yield `<title>${xml(site.name)} articles</title><link>${xml(publicUrl("/articles"))}</link>`;
  yield `<description>${xml(site.description)}</description>`;
  for (const article of publishedArticleFeedRows()) {
    const url = publicUrl(`/articles/${article.slug}`);
    const date = article.published_at ? new Date(article.published_at).toUTCString() : "";
    yield `<item><title>${xml(article.title)}</title><link>${xml(url)}</link>`;
    yield `<guid isPermaLink="true">${xml(url)}</guid><description>${xml(article.summary)}</description>`;
    if (date) yield `<pubDate>${xml(date)}</pubDate>`;
    yield "</item>";
  }
  yield "</channel></rss>";
}

export async function GET() {
  await connection();
  const iterator = feedChunks();
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = iterator.next();
      if (next.done) controller.close();
      else controller.enqueue(encoder.encode(next.value));
    },
    cancel() { iterator.return(""); },
  });
  return new Response(stream, {
    headers: { "Content-Type": "application/rss+xml; charset=utf-8", "Cache-Control": "no-store" },
  });
}
