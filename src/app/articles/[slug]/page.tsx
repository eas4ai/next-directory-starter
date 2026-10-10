import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { publishedArticleBySlug } from "@/lib/articles";
import { pageMetadata, publicUrl } from "@/lib/page-metadata";
import { getSiteConfig } from "@/lib/site-config";
import { JsonLd } from "@/components/json-ld";
import { MarkdownContent } from "@/components/markdown-content";

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  await connection();
  const article = publishedArticleBySlug((await params).slug);
  if (!article) notFound();
  return pageMetadata(`/articles/${article.slug}`, `${article.title} | ${getSiteConfig().name}`, article.summary);
}

export default async function ArticlePage({ params }: Params) {
  await connection();
  const article = publishedArticleBySlug((await params).slug);
  if (!article) notFound();
  return (
    <main className="mx-auto w-full max-w-[1400px] px-6 py-12">
      <JsonLd data={{
        "@context": "https://schema.org", "@type": "Article",
        headline: article.title, description: article.summary,
        articleBody: article.body, url: publicUrl(`/articles/${article.slug}`),
        ...(article.publishedAt ? { datePublished: article.publishedAt } : {}),
        ...(article.tags.length > 0 ? { keywords: article.tags } : {}),
      }} />
      <Link href="/articles" className="text-sm text-muted-foreground hover:text-foreground">← Articles</Link>
      <article className="mt-10">
        <h1 className="text-4xl font-semibold tracking-tight">{article.title}</h1>
        <p className="mt-5 text-lg text-muted-foreground">{article.summary}</p>
        {article.publishedAt && <time className="mt-5 block text-sm text-muted-foreground" dateTime={article.publishedAt}>
          Published {new Date(article.publishedAt).toLocaleDateString("en-US", { timeZone: "UTC" })}
        </time>}
        <div className="mt-10"><MarkdownContent source={article.body} /></div>
        {article.tags.length > 0 && <p className="mt-10 border-t pt-5 text-sm text-muted-foreground">Tags: {article.tags.join(" · ")}</p>}
      </article>
    </main>
  );
}
