import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { activeFeaturedSlugs, publishedListingBySlug } from "@/lib/listings";
import { getThemePreset } from "@/lib/theme";
import { PresetExternalLinkIcon } from "@/components/preset-icon";
import { connection } from "next/server";
import { pageMetadata, publicUrl } from "@/lib/page-metadata";
import { getSiteConfig } from "@/lib/site-config";
import { JsonLd } from "@/components/json-ld";
import { MarkdownContent } from "@/components/markdown-content";
import { ContentImage } from "@/components/content-image";
import { assignedMedia } from "@/lib/media";
import { publicSeoOverrides } from "@/lib/seo-settings";
import { database } from "@/lib/database";

export const instant = false;

export async function generateMetadata({ params }: PageProps<"/listings/[slug]">) {
  await connection();
  const { slug } = await params;
  const listing = publishedListingBySlug(slug);
  if (!listing) notFound();
  const overrides = publicSeoOverrides("listing", listing.slug);
  const imported = database.prepare("SELECT 1 FROM agent_imports WHERE slug = ?").get(listing.slug);
  const metadata = pageMetadata(`/listings/${listing.slug}`, `${listing.name} | ${getSiteConfig().name}`,
    listing.summary, { ...overrides, socialImage: overrides.socialImage ||
      (imported ? `/og/listings/${listing.slug}.png` : null) });
  return { ...metadata, alternates: { ...metadata.alternates,
    types: { "text/markdown": publicUrl(`/markdown/listings/${listing.slug}`) } } };
}

export default async function ListingPage({ params }: PageProps<"/listings/[slug]">) {
  await connection();
  const { slug } = await params;
  const listing = publishedListingBySlug(slug);
  if (!listing) notFound();
  const preset = getThemePreset();
  const featured = activeFeaturedSlugs([listing.slug]).has(listing.slug);
  const image = assignedMedia("listing", listing.slug, "public");

  return (
    <main className="mx-auto w-full max-w-[1400px] wrap-anywhere px-6 py-12">
      <JsonLd data={{
        "@context": "https://schema.org", "@type": "Thing",
        name: listing.name, description: listing.description, url: listing.url,
        mainEntityOfPage: publicUrl(`/listings/${listing.slug}`),
      }} />
      <Link href="/listings" className="text-sm text-muted-foreground hover:text-foreground">← Listings</Link>
      <a href={`/markdown/listings/${listing.slug}`} type="text/markdown" rel="alternate"
        className="ml-4 text-sm underline">Markdown version</a>
      <p className="mt-10 text-sm font-medium uppercase tracking-widest text-muted-foreground">{listing.category}</p>
      {featured && <p className="mt-3 w-fit rounded-full bg-primary px-2 py-1 text-xs font-semibold text-primary-foreground">Featured</p>}
      <h1 className="mt-3 text-4xl font-semibold tracking-tight">{listing.name}</h1>
      <p className="mt-5 text-lg text-muted-foreground">{listing.summary}</p>
      {image && <div className="mt-8"><ContentImage asset={image} /></div>}
      <div className="mt-8"><MarkdownContent source={listing.description} /></div>
      <div className="mt-8"><Button asChild className="h-auto min-h-8 max-w-full whitespace-normal wrap-anywhere text-center"><a href={listing.url} target="_blank" rel="noopener noreferrer">Visit {listing.name} <PresetExternalLinkIcon library={preset.iconLibrary} /></a></Button></div>
    </main>
  );
}
