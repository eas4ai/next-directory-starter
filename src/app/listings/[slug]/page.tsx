import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { publishedListingBySlug } from "@/lib/listings";
import { getThemePreset } from "@/lib/theme";
import { PresetExternalLinkIcon } from "@/components/preset-icon";
import { connection } from "next/server";
import { pageMetadata, publicUrl } from "@/lib/page-metadata";
import { getSiteConfig } from "@/lib/site-config";
import { JsonLd } from "@/components/json-ld";

export const instant = false;

export async function generateMetadata({ params }: PageProps<"/listings/[slug]">) {
  await connection();
  const { slug } = await params;
  const listing = publishedListingBySlug(slug);
  if (!listing) notFound();
  return pageMetadata(`/listings/${listing.slug}`, `${listing.name} | ${getSiteConfig().name}`, listing.summary);
}

export default async function ListingPage({ params }: PageProps<"/listings/[slug]">) {
  const { slug } = await params;
  const listing = publishedListingBySlug(slug);
  if (!listing) notFound();
  const preset = getThemePreset();

  return (
    <main className="mx-auto w-full max-w-[1400px] px-6 py-12">
      <JsonLd data={{
        "@context": "https://schema.org", "@type": "Thing",
        name: listing.name, description: listing.description, url: listing.url,
        mainEntityOfPage: publicUrl(`/listings/${listing.slug}`),
      }} />
      <Link href="/listings" className="text-sm text-muted-foreground hover:text-foreground">← Listings</Link>
      <p className="mt-10 text-sm font-medium uppercase tracking-widest text-muted-foreground">{listing.category}</p>
      <h1 className="mt-3 text-4xl font-semibold tracking-tight">{listing.name}</h1>
      <p className="mt-5 text-lg text-muted-foreground">{listing.summary}</p>
      <p className="mt-8 leading-relaxed">{listing.description}</p>
      <div className="mt-8"><Button asChild><a href={listing.url} target="_blank" rel="noopener noreferrer">Visit {listing.name} <PresetExternalLinkIcon library={preset.iconLibrary} /></a></Button></div>
    </main>
  );
}
