import { connection } from "next/server";
import { JsonLd } from "@/components/json-ld";
import { DefaultPublicComparison } from "@/components/public-template-defaults";
import { activeDirectoryProfiles } from "@/lib/directory-profiles";
import { activeFeaturedSlugs, publishedListingBySlug } from "@/lib/listings";
import { profileMediaIds, publicProfileMediaAssets } from "@/lib/media";
import { pageMetadata, publicUrl } from "@/lib/page-metadata";
import { publicTemplateDefinition } from "@/lib/public-template-registry";
import { publicTemplateFields } from "@/lib/public-template-sdk";
import { getSiteConfig } from "@/lib/site-config";
import { getThemeSelection } from "@/lib/theme-selection";

type CompareQuery = Record<string, string | string[] | undefined>;

function requestedTools(input: CompareQuery): { slugs: string[]; message?: string } {
  if (Object.keys(input).some((key) => key !== "tool")) {
    return { slugs: [], message: "The comparison request was invalid. Choose 2 to 4 tools." };
  }
  const values = input.tool === undefined ? [] : Array.isArray(input.tool) ? input.tool : [input.tool];
  if (values.length === 0) return { slugs: [], message: "Choose 2 to 4 tools from the directory." };
  if (values.length < 2 || values.length > 4 || new Set(values).size !== values.length ||
      values.some((value) => !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value))) {
    return { slugs: [], message: "The comparison request was invalid. Choose 2 to 4 unique tools." };
  }
  return { slugs: values };
}

export async function generateMetadata({ searchParams }: PageProps<"/compare">) {
  await connection();
  const hasQuery = Object.keys(await searchParams).length > 0;
  return { ...pageMetadata("/compare", `Compare tools | ${getSiteConfig().name}`,
    "Compare eligible directory listings side by side."),
  ...(hasQuery ? { robots: { index: false, follow: true } } : {}) };
}

export default async function ComparePage({ searchParams }: PageProps<"/compare">) {
  await connection();
  const requested = requestedTools(await searchParams);
  const resolved = requested.slugs.map((slug) => publishedListingBySlug(slug));
  const valid = !requested.message && resolved.every((listing) => listing !== undefined);
  const rawListings = valid ? resolved.filter((listing) => listing !== undefined) : [];
  const featured = activeFeaturedSlugs(rawListings.map(({ slug }) => slug));
  const listings = rawListings.map((listing) => ({ ...listing, featured: featured.has(listing.slug) }));
  const profiles = activeDirectoryProfiles();
  const fields = publicTemplateFields(profiles);
  const mediaIds = listings.flatMap((listing) =>
    [...profileMediaIds(listing.profileValues, profiles)]);
  const mediaAssets = publicProfileMediaAssets(mediaIds);
  const definition = publicTemplateDefinition(getThemeSelection().templateId);
  const Renderer = definition?.renderers.comparison ?? DefaultPublicComparison;
  const message = requested.message ?? (!valid
    ? "One or more tools are unavailable. Choose 2 to 4 published tools from the directory."
    : undefined);

  return <>
    {valid && <JsonLd data={{
      "@context": "https://schema.org", "@type": "ItemList",
      name: "Tool comparison", url: publicUrl("/compare"),
      itemListElement: listings.map((listing, index) => ({
        "@type": "ListItem", position: index + 1, name: listing.name,
        url: publicUrl(`/listings/${listing.slug}`),
      })),
    }} />}
    <Renderer listings={listings} fields={fields} mediaAssets={mediaAssets} message={message} />
  </>;
}
