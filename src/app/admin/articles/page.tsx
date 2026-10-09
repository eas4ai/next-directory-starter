import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { canEditArticles, sessionUser } from "@/lib/admin";
import { listArticles } from "@/lib/articles";
import { getSiteConfig } from "@/lib/site-config";
import { ArticleEditor } from "./article-editor";

export async function generateMetadata(): Promise<Metadata> {
  await connection();
  return {
    title: `Articles | ${getSiteConfig().name}`,
    description: "Private article editing workspace.",
    robots: { index: false, follow: false },
  };
}

export default async function AdminArticlesPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  await connection();
  const user = await sessionUser(await headers());
  if (!canEditArticles(user?.role)) notFound();
  const requestedPage = Number((await searchParams).page ?? "1");
  const { articles, page, pages } = listArticles(requestedPage);
  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <Link href="/articles" className="text-sm text-muted-foreground hover:text-foreground">← Public articles</Link>
      <h1 className="mt-7 text-3xl font-semibold tracking-tight">Articles</h1>
      <p className="mt-3 text-muted-foreground">Save drafts and control which articles appear publicly.</p>
      <ArticleEditor initialArticles={articles} />
      {pages > 1 && (
        <nav className="mt-8 flex items-center justify-between text-sm" aria-label="Editor pages">
          {page > 1 ? <Link href={`/admin/articles?page=${page - 1}`} className="underline">Previous</Link> : <span />}
          <span>Page {page} of {pages}</span>
          {page < pages ? <Link href={`/admin/articles?page=${page + 1}`} className="underline">Next</Link> : <span />}
        </nav>
      )}
    </main>
  );
}
