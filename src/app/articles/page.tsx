import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { listArticles } from "@/lib/articles";
import { pageMetadata, publicUrl } from "@/lib/page-metadata";
import { getSiteConfig } from "@/lib/site-config";
import { JsonLd } from "@/components/json-ld";

export async function generateMetadata({ searchParams }: PageProps<"/articles">): Promise<Metadata> {
  await connection();
  const hasQuery = Object.keys(await searchParams).length > 0;
  return {
    ...pageMetadata("/articles", `Articles | ${getSiteConfig().name}`, "Read published articles from this directory."),
    ...(hasQuery ? { robots: { index: false, follow: true } } : {}),
  };
}

export default async function ArticlesPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  await connection();
  const requestedPage = Number((await searchParams).page ?? "1");
  const { articles, page, pages } = listArticles(requestedPage, true);
  return (
    <main className="mx-auto w-full max-w-[1400px] px-6 py-12">
      <JsonLd data={{
        "@context": "https://schema.org", "@type": "CollectionPage",
        name: "Articles", description: "Stories and updates from this directory.",
        url: publicUrl("/articles"),
        mainEntity: { "@type": "ItemList", itemListElement: articles.map((article, index) => ({
          "@type": "ListItem", position: index + 1,
          name: article.title, url: publicUrl(`/articles/${article.slug}`),
        })) },
      }} />
      <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">← Home</Link>
      <h1 className="mt-8 text-4xl font-semibold tracking-tight">Articles</h1>
      <p className="mt-3 max-w-2xl text-muted-foreground">Stories and updates from this directory.</p>
      <Link href="/feed.xml" className="mt-4 inline-block text-sm underline">RSS feed</Link>
      <div className="mt-10 grid gap-5 sm:grid-cols-2">
        {articles.map((article) => (
          <article key={article.slug} className="rounded-lg border p-6">
            <h2 className="text-xl font-semibold"><Link href={`/articles/${article.slug}`} className="hover:underline">{article.title}</Link></h2>
            <p className="mt-3 text-muted-foreground">{article.summary}</p>
            {article.tags.length > 0 && <p className="mt-4 text-xs text-muted-foreground">{article.tags.join(" · ")}</p>}
          </article>
        ))}
      </div>
      {articles.length === 0 && <p className="mt-8 text-muted-foreground">No published articles yet.</p>}
      {pages > 1 && (
        <nav className="mt-8 flex items-center justify-between text-sm" aria-label="Article pages">
          {page > 1 ? <Link href={`/articles?page=${page - 1}`} className="underline">Previous</Link> : <span />}
          <span>Page {page} of {pages}</span>
          {page < pages ? <Link href={`/articles?page=${page + 1}`} className="underline">Next</Link> : <span />}
        </nav>
      )}
    </main>
  );
}
