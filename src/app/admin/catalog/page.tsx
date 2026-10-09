import { headers } from "next/headers";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { isAdmin } from "@/lib/admin";
import { allListings } from "@/lib/listings";
import { CatalogEditor } from "./catalog-editor";

export const metadata: Metadata = {
  title: "Catalog | Directory Starter",
  description: "Administrator listing controls.",
  robots: { index: false, follow: false },
};

export default async function CatalogPage() {
  if (!(await isAdmin(await headers()))) notFound();
  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Catalog</h1>
      <p className="mt-3 text-muted-foreground">Create listings and manage their publication state.</p>
      <CatalogEditor initialListings={allListings()} />
    </main>
  );
}
