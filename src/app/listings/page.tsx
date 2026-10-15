import { connection } from "next/server";
import { JsonLd } from "@/components/json-ld";
import { ProfileFacets } from "@/components/profile-facets";
import { activeDirectoryProfiles } from "@/lib/directory-profiles";
import {
  parseProfileDirectoryQuery, profileDiscoveryDescriptors, searchProfileDirectory,
  serializeProfileDirectoryQuery,
} from "@/lib/profile-discovery";
import { activeFeaturedSlugs, directoryCategories, LISTINGS_PER_PAGE } from "@/lib/listings";
import { pageMetadata, publicUrl } from "@/lib/page-metadata";
import { getSiteConfig } from "@/lib/site-config";
import { getThemePreset } from "@/lib/theme";
import { profileMediaIds, publicProfileMediaAssets } from "@/lib/media";
import { getThemeSelection } from "@/lib/theme-selection";
import { publicTemplateDefinition } from "@/lib/public-template-registry";
import { DefaultPublicDirectory } from "@/components/public-template-defaults";

export async function generateMetadata({ searchParams }: PageProps<"/listings">) {
  await connection();
  const hasQuery = Object.keys(await searchParams).length > 0;
  return {
    ...pageMetadata("/listings", `Listings | ${getSiteConfig().name}`,
      "Explore the published links in this directory."),
    ...(hasQuery ? { robots: { index: false, follow: true } } : {}),
  };
}

export default async function ListingsPage({ searchParams }: PageProps<"/listings">) {
  await connection();
  const input = await searchParams;
  const profiles = activeDirectoryProfiles();
  const fields = profiles.definitions.flatMap((definition) => definition.fields);
  const descriptors = profileDiscoveryDescriptors(profiles);
  const query = parseProfileDirectoryQuery(input, profiles);
  const result = searchProfileDirectory(query);
  const mediaIds = result.listings.flatMap((listing) =>
    [...profileMediaIds(listing.profileValues, profiles)]);
  const mediaAssets = publicProfileMediaAssets(mediaIds);
  const featuredSlugs = activeFeaturedSlugs(result.listings.map((listing) => listing.slug));
  const listings = result.listings.map((listing) => ({
    ...listing, featured: featuredSlugs.has(listing.slug),
  }));
  const featured = listings.filter((listing) => listing.featured);
  const preset = getThemePreset();
  const pageHref = (page: number) => `/listings?${serializeProfileDirectoryQuery(query, page)}`;

  const definition = publicTemplateDefinition(getThemeSelection().templateId);
  const Renderer = definition?.renderers.directory ?? DefaultPublicDirectory;
  const facets = <ProfileFacets descriptors={descriptors} query={query}
    facetCounts={result.facetCounts} categories={directoryCategories()} />;

  return <>
    <JsonLd data={{
        "@context": "https://schema.org", "@type": "CollectionPage",
        name: "Listings", description: "Explore the published links in this directory.",
        url: publicUrl("/listings"),
        mainEntity: { "@type": "ItemList", itemListElement: result.listings.map((listing, index) => ({
          "@type": "ListItem", position: (result.page - 1) * LISTINGS_PER_PAGE + index + 1,
          name: listing.name, url: publicUrl(`/listings/${listing.slug}`),
        })) },
      }} />
    <Renderer title="Listings" description="Explore the published links in this directory."
      total={result.total} listings={listings} featured={featured} fields={fields}
      mediaAssets={mediaAssets} facets={facets} iconLibrary={preset.iconLibrary}
      slots={definition?.renderers}
      pagination={{ page: result.page, pages: result.pages,
        previousHref: result.page > 1 ? pageHref(result.page - 1) : undefined,
        nextHref: result.page < result.pages ? pageHref(result.page + 1) : undefined }} />
  </>;
}
