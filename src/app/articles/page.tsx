import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { publishedArticleTerms, searchPublishedArticles } from "@/lib/articles";
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

export default async function ArticlesPage({ searchParams }: {
  searchParams: Promise<{ q?: string; category?: string; tag?: string; page?: string }>;
}) {
  await connection();
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q.slice(0, 120) : "";
  const category = typeof params.category === "string" ? params.category.slice(0, 80) : "";
  const tag = typeof params.tag === "string" ? params.tag.slice(0, 80) : "";
  const { articles, page, pages, total } = searchPublishedArticles({
    query, category, tag, page: Number(params.page ?? "1"),
  });
  const terms = publishedArticleTerms();
  const href = (next: { q?: string; category?: string; tag?: string; page?: number }) => {
    const values = new URLSearchParams();
    if (next.q) values.set("q", next.q);
    if (next.category) values.set("category", next.category);
    if (next.tag) values.set("tag", next.tag);
    if (next.page && next.page > 1) values.set("page", String(next.page));
    return `/articles${values.size ? `?${values}` : ""}`;
  };
  return (
    <main className="site-container">
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
      <form action="/articles" method="get" className="mt-8 flex flex-wrap items-end gap-3">
        <label className="grid min-w-48 flex-1 gap-2 text-sm font-medium">Search articles
          <input name="q" defaultValue={query} maxLength={120} className="h-10 rounded-md border border-input bg-background px-3" placeholder="Title, summary, or body" />
        </label>
        {category && <input type="hidden" name="category" value={category} />}
        {tag && <input type="hidden" name="tag" value={tag} />}
        <button type="submit" className="h-10 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">Search</button>
      </form>
      {(terms.categories.length > 0 || terms.tags.length > 0) && (
        <nav className="mt-7 space-y-3 text-sm" aria-label="Article topics">
          {terms.categories.length > 0 && <div className="flex flex-wrap gap-3"><span className="font-medium">Categories:</span>
            {terms.categories.map((name) => <Link key={name} href={href({ q: query, category: name, tag })} className="underline">{name}</Link>)}
          </div>}
          {terms.tags.length > 0 && <div className="flex flex-wrap gap-3"><span className="font-medium">Tags:</span>
            {terms.tags.map((name) => <Link key={name} href={href({ q: query, category, tag: name })} className="underline">{name}</Link>)}
          </div>}
          {(category || tag) && <Link href={href({ q: query })} className="inline-block underline">Clear topic filters</Link>}
        </nav>
      )}
      <p className="mt-6 text-sm text-muted-foreground">{total} published {total === 1 ? "article" : "articles"}</p>
      <div className="template-article-grid mt-10">
        {articles.map((article) => (
          <article key={article.slug} className="rounded-lg border p-6">
            <h2 className="text-xl font-semibold"><Link href={`/articles/${article.slug}`} className="hover:underline">{article.title}</Link></h2>
            <p className="mt-3 text-muted-foreground">{article.summary}</p>
            {article.category && <p className="mt-4 text-xs text-muted-foreground">{article.category}</p>}
            {article.tags.length > 0 && <p className="mt-2 text-xs text-muted-foreground">{article.tags.join(" · ")}</p>}
          </article>
        ))}
      </div>
      {articles.length === 0 && <p className="mt-8 text-muted-foreground">No published articles yet.</p>}
      {pages > 1 && (
        <nav className="mt-8 flex items-center justify-between text-sm" aria-label="Article pages">
          {page > 1 ? <Link href={href({ q: query, category, tag, page: page - 1 })} className="underline">Previous</Link> : <span />}
          <span>Page {page} of {pages}</span>
          {page < pages ? <Link href={href({ q: query, category, tag, page: page + 1 })} className="underline">Next</Link> : <span />}
        </nav>
      )}
    </main>
  );
}
