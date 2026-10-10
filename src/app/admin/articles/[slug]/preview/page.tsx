import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { MarkdownContent } from "@/components/markdown-content";
import { canEditArticles, sessionUser } from "@/lib/admin";
import { editableArticleBySlug } from "@/lib/articles";

type Params = { params: Promise<{ slug: string }> };

export const metadata: Metadata = { title: "Private article preview", robots: { index: false, follow: false } };

export default async function ArticlePreview({ params }: Params) {
  await connection();
  const user = await sessionUser(await headers());
  if (!canEditArticles(user?.role)) notFound();
  const article = editableArticleBySlug((await params).slug);
  if (!article) notFound();
  return (
    <main className="mx-auto w-full max-w-[1400px] px-6 py-12">
      <Link href="/admin/articles" className="text-sm underline">← Article editor</Link>
      <p className="mt-8 text-sm font-medium uppercase tracking-wide text-muted-foreground">Private preview · {article.staged ? "saved revision" : article.status}</p>
      <h1 className="mt-4 text-4xl font-semibold">{article.title}</h1>
      <p className="mt-5 text-lg text-muted-foreground">{article.summary}</p>
      <div className="mt-10"><MarkdownContent source={article.body} /></div>
    </main>
  );
}
