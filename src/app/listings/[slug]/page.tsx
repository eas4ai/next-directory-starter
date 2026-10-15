import { notFound } from "next/navigation";
import { activeFeaturedSlugs, publishedListingBySlug } from "@/lib/listings";
import { getThemePreset } from "@/lib/theme";
import { connection } from "next/server";
import { pageMetadata, publicUrl } from "@/lib/page-metadata";
import { getSiteConfig } from "@/lib/site-config";
import { JsonLd } from "@/components/json-ld";
import { assignedMedia, profileMediaIds, publicProfileMediaAssets } from "@/lib/media";
import { publicSeoOverrides } from "@/lib/seo-settings";
import { database } from "@/lib/database";
import { activeDirectoryProfiles } from "@/lib/directory-profiles";
import type { DirectoryProfileField, ProfileValueSet } from "@/lib/directory-profile-types";
import { getThemeSelection } from "@/lib/theme-selection";
import { publicTemplateDefinition } from "@/lib/public-template-registry";
import { DefaultPublicListing } from "@/components/public-template-defaults";

export const instant = false;

function publicProfileProperties(fields: DirectoryProfileField[], values: ProfileValueSet) {
  const scalarTypes = new Set(["short-text", "boolean", "integer", "decimal", "money",
    "single-choice", "date", "datetime", "duration"]);
  return fields.filter((field) => field.visibility === "public" && field.placement !== "hidden" &&
    scalarTypes.has(field.type) && Object.hasOwn(values, field.key)).map((field) => {
      const raw = values[field.key];
      const value = field.type === "money" && raw && typeof raw === "object"
        ? `${(raw as { currency: string }).currency}:${(raw as { amountMinor: number }).amountMinor}`
        : raw;
      return { "@type": "PropertyValue", name: field.label, value };
    });
}

export async function generateMetadata({ params }: PageProps<"/listings/[slug]">) {
  await connection();
  const { slug } = await params;
  const listing = publishedListingBySlug(slug);
  if (!listing) notFound();
  const overrides = publicSeoOverrides("listing", listing.slug);
  const imported = database.prepare("SELECT 1 FROM agent_imports WHERE slug = ?").get(listing.slug);
  const image = assignedMedia("listing", listing.slug, "public");
  const metadata = pageMetadata(`/listings/${listing.slug}`, `${listing.name} | ${getSiteConfig().name}`,
    listing.summary, overrides, {
      published: image ? `/media/${image.id}` : undefined,
      generated: imported ? `/og/listings/${listing.slug}.png` : undefined,
    });
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
  const profiles = activeDirectoryProfiles();
  const fields = profiles.definitions.flatMap((definition) => definition.fields);
  const properties = publicProfileProperties(fields, listing.profileValues);
  const profileMedia = publicProfileMediaAssets([...profileMediaIds(listing.profileValues, profiles)]);
  const definition = publicTemplateDefinition(getThemeSelection().templateId);
  const Renderer = definition?.renderers.listing ?? DefaultPublicListing;
  const value = { listing: { ...listing, featured }, fields, mediaAssets: profileMedia,
    image, markdownHref: `/markdown/listings/${listing.slug}`, iconLibrary: preset.iconLibrary };

  return <>
    <JsonLd data={{
        "@context": "https://schema.org", "@type": "Thing",
        name: listing.name, description: listing.description, url: listing.url,
        mainEntityOfPage: publicUrl(`/listings/${listing.slug}`),
        ...(properties.length ? { additionalProperty: properties } : {}),
      }} />
    <Renderer {...value} />
  </>;
}
