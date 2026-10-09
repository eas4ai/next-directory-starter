import type { MetadataRoute } from "next";
import { connection } from "next/server";
import { database } from "@/lib/database";
import { migrateCatalog } from "@/lib/catalog-migrations";
import { publicUrl } from "@/lib/page-metadata";
import { PUBLIC_LISTING_PREDICATE } from "@/lib/listings";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await connection();
  migrateCatalog();
  const listings = database.prepare(`SELECT l.slug FROM listings l WHERE ${PUBLIC_LISTING_PREDICATE} ORDER BY l.slug`)
    .all() as { slug: string }[];
  const articles = database.prepare(`SELECT slug, published_at FROM articles
    WHERE status = 'published' ORDER BY slug`)
    .all() as { slug: string; published_at: string | null }[];
  return [
    { url: publicUrl("/") },
    { url: publicUrl("/listings") },
    { url: publicUrl("/articles") },
    ...listings.map(({ slug }) => ({ url: publicUrl(`/listings/${slug}`) })),
    ...articles.map(({ slug, published_at }) => ({
      url: publicUrl(`/articles/${slug}`),
      ...(published_at ? { lastModified: new Date(published_at) } : {}),
    })),
  ];
}
