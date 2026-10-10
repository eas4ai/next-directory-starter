import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { publishedArticleBySlug } from "@/lib/articles";
import { pageMetadata, publicUrl } from "@/lib/page-metadata";
import { getSiteConfig } from "@/lib/site-config";
import { JsonLd } from "@/components/json-ld";
import { MarkdownContent } from "@/components/markdown-content";
import { ContentImage } from "@/components/content-image";
import { assignedMedia } from "@/lib/media";

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  await connection();
  const article = publishedArticleBySlug((await params).slug);
  if (!article) notFound();
  const metadata = pageMetadata(`/articles/${article.slug}`, `${article.title} | ${getSiteConfig().name}`,
    article.summary, article.seo);
  return { ...metadata, alternates: { ...metadata.alternates,
    types: { "text/markdown": publicUrl(`/markdown/articles/${article.slug}`) } } };
}

export default async function ArticlePage({ params }: Params) {
  await connection();
  const article = publishedArticleBySlug((await params).slug);
  if (!article) notFound();
  const image = assignedMedia("article", article.slug, "public");
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
      <a href={`/markdown/articles/${article.slug}`} type="text/markdown" rel="alternate"
        className="ml-4 text-sm underline">Markdown version</a>
      <article className="mt-10">
        <h1 className="text-4xl font-semibold tracking-tight">{article.title}</h1>
        <p className="mt-5 text-lg text-muted-foreground">{article.summary}</p>
        {article.publishedAt && <time className="mt-5 block text-sm text-muted-foreground" dateTime={article.publishedAt}>
          Published {new Date(article.publishedAt).toLocaleDateString("en-US", { timeZone: "UTC" })}
        </time>}
        {article.category && <p className="mt-4 text-sm">Category: <Link className="underline" href={`/articles?category=${encodeURIComponent(article.category)}`}>{article.category}</Link></p>}
        {image && <div className="mt-8"><ContentImage asset={image} /></div>}
        <div className="mt-10"><MarkdownContent source={article.body} /></div>
        {article.tags.length > 0 && <p className="mt-10 flex flex-wrap gap-2 border-t pt-5 text-sm text-muted-foreground">Tags:
          {article.tags.map((tag) => <Link key={tag} href={`/articles?tag=${encodeURIComponent(tag)}`} className="underline">{tag}</Link>)}
        </p>}
      </article>
    </main>
  );
}
