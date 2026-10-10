import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { canManageTaxonomy, sessionUser } from "@/lib/admin";
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
  if (!canManageTaxonomy(user?.role)) notFound();
  return (
    <main className="mx-auto w-full max-w-[1400px] px-6 py-10">
      <Link href="/admin/overview" className="text-sm text-muted-foreground hover:text-foreground">← Overview</Link>
      <h1 className="mt-7 text-3xl font-semibold tracking-tight">Categories and Tags</h1>
      <p className="mt-3 text-muted-foreground">Organize listings and articles without changing source code.</p>
      <TaxonomyEditor categories={listTaxa("category")}
        articleCategories={listTaxa("article-category")}
        tags={listTaxa("tag")} operator />
    </main>
  );
}
