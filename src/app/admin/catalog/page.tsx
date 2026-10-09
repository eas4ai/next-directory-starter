import { headers } from "next/headers";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { isAdmin } from "@/lib/admin";
import { allListings } from "@/lib/listings";
import { CatalogEditor } from "./catalog-editor";
import { connection } from "next/server";
import { getSiteConfig } from "@/lib/site-config";
import Link from "next/link";

export async function generateMetadata(): Promise<Metadata> {
  await connection();
  return {
    title: `Catalog | ${getSiteConfig().name}`,
    description: "Administrator listing controls.",
    robots: { index: false, follow: false },
  };
}

export default async function CatalogPage() {
  if (!(await isAdmin(await headers()))) notFound();
  return (
    <main className="mx-auto w-full max-w-[1400px] px-6 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Catalog</h1>
      <p className="mt-3 text-muted-foreground">Create listings and manage their publication state.</p>
      <Link href="/admin/review" className="mt-3 inline-block text-sm underline">Review owner submissions</Link>
      <Link href="/admin/articles" className="ml-4 mt-3 inline-block text-sm underline">Edit articles</Link>
      <Link href="/admin/taxonomy" className="ml-4 mt-3 inline-block text-sm underline">Categories and tags</Link>
      <CatalogEditor initialListings={allListings()} />
    </main>
  );
}
