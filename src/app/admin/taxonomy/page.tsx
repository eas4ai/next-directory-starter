import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { canAdmin, canEditArticles, sessionUser } from "@/lib/admin";
import { getSiteConfig } from "@/lib/site-config";
import { listTaxa } from "@/lib/taxonomy";
import { TaxonomyEditor } from "./taxonomy-editor";

export async function generateMetadata(): Promise<Metadata> {
  await connection();
  return {
    title: `Taxonomy | ${getSiteConfig().name}`,
    description: "Private category and tag management.",
    robots: { index: false, follow: false },
  };
}

export default async function TaxonomyPage() {
  await connection();
  const user = await sessionUser(await headers());
  if (!canEditArticles(user?.role)) notFound();
  const operator = canAdmin(user?.role);
  return (
    <main className="mx-auto w-full max-w-[1400px] px-6 py-10">
      <Link href={operator ? "/admin/catalog" : "/admin/articles"}
        className="text-sm text-muted-foreground hover:text-foreground">
        ← {operator ? "Catalog" : "Articles"}
      </Link>
      <h1 className="mt-7 text-3xl font-semibold tracking-tight">
        {operator ? "Categories and Tags" : "Article categories"}
      </h1>
      <p className="mt-3 text-muted-foreground">
        {operator ? "Organize listings and articles without changing source code."
          : "Organize article topics without changing listing categories."}
      </p>
      <TaxonomyEditor categories={operator ? listTaxa("category") : []}
        articleCategories={listTaxa("article-category")}
        tags={operator ? listTaxa("tag") : []} operator={operator} />
    </main>
  );
}
