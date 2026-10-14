import Link from "next/link";
import { connection } from "next/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { JsonLd } from "@/components/json-ld";
import { PresetExternalLinkIcon } from "@/components/preset-icon";
import { ProfileFacets } from "@/components/profile-facets";
import { ProfileValuesView } from "@/components/profile-values-view";
import { activeDirectoryProfiles } from "@/lib/directory-profiles";
import type { DirectoryProfileField } from "@/lib/directory-profile-types";
import {
  parseProfileDirectoryQuery, profileDiscoveryDescriptors, searchProfileDirectory,
  serializeProfileDirectoryQuery,
} from "@/lib/profile-discovery";
import {
  activeFeaturedSlugs, directoryCategories, LISTINGS_PER_PAGE, type Listing,
} from "@/lib/listings";
import { pageMetadata, publicUrl } from "@/lib/page-metadata";
import { getSiteConfig } from "@/lib/site-config";
import { getThemePreset } from "@/lib/theme";
import {
  profileMediaIds, publicProfileMediaAssets, type MediaAsset,
} from "@/lib/media";

function ListingResultCard({ listing, fields, mediaAssets, iconLibrary, featured,
  highlighted = false }: {
    listing: Listing;
    fields: DirectoryProfileField[];
    mediaAssets: ReadonlyMap<string, MediaAsset>;
    iconLibrary: ReturnType<typeof getThemePreset>["iconLibrary"];
    featured: boolean;
    highlighted?: boolean;
  }) {
  return <Card className={`min-w-0 ${highlighted ? "border-primary/50" : ""}`}>
    <CardHeader>
      {highlighted && <span className="w-fit rounded-full bg-primary px-2 py-1 text-xs font-semibold text-primary-foreground">
        Featured
      </span>}
      <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
        {listing.category}{featured && !highlighted ? " · Featured" : ""}
      </p>
      <CardTitle><Link href={`/listings/${listing.slug}`}
        className="inline-flex max-w-full items-center gap-1 wrap-anywhere hover:underline">
        {listing.name}<PresetExternalLinkIcon library={iconLibrary} />
      </Link></CardTitle>
    </CardHeader>
    <CardContent className="min-w-0">
      <p className="text-muted-foreground">{listing.summary}</p>
      <ProfileValuesView fields={fields} values={listing.profileValues}
        placements={["badge", "card"]} mediaAssets={mediaAssets} />
    </CardContent>
  </Card>;
}

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
  const featured = result.listings.filter((listing) => featuredSlugs.has(listing.slug));
  const preset = getThemePreset();
  const pageHref = (page: number) => `/listings?${serializeProfileDirectoryQuery(query, page)}`;

  return (
    <main className="site-container wrap-anywhere">
      <JsonLd data={{
        "@context": "https://schema.org", "@type": "CollectionPage",
        name: "Listings", description: "Explore the published links in this directory.",
        url: publicUrl("/listings"),
        mainEntity: { "@type": "ItemList", itemListElement: result.listings.map((listing, index) => ({
          "@type": "ListItem", position: (result.page - 1) * LISTINGS_PER_PAGE + index + 1,
          name: listing.name, url: publicUrl(`/listings/${listing.slug}`),
        })) },
      }} />
      <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">← Home</Link>
      <div className="mt-8">
        <h1 className="text-4xl font-semibold tracking-tight">Listings</h1>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          Explore the published links in this directory.
        </p>
      </div>
      <ProfileFacets descriptors={descriptors} query={query} facetCounts={result.facetCounts}
        categories={directoryCategories()} />
      <p className="mt-6 text-sm text-muted-foreground" role="status">
        {result.total} {result.total === 1 ? "listing" : "listings"} found
      </p>
      {featured.length > 0 && (
        <section aria-label="Featured listings" className="mt-8">
          <h2 className="text-xl font-semibold">Featured listings</h2>
          <p className="mt-1 text-sm text-muted-foreground">Paid placements matching these filters.</p>
          <div className="template-listing-grid mt-4">
            {featured.map((listing) => (
              <ListingResultCard key={listing.slug} listing={listing} fields={fields}
                mediaAssets={mediaAssets} iconLibrary={preset.iconLibrary} featured highlighted />
            ))}
          </div>
        </section>
      )}
      <section aria-label="Directory results" data-testid="ordinary-results"
        className="template-listing-grid mt-8">
        {result.listings.map((listing) => (
          <ListingResultCard key={listing.slug} listing={listing} fields={fields}
            mediaAssets={mediaAssets} iconLibrary={preset.iconLibrary}
            featured={featuredSlugs.has(listing.slug)} />
        ))}
      </section>
      {result.listings.length === 0 &&
        <p className="mt-6 text-muted-foreground">No listings match these filters.</p>}
      {result.pages > 1 && (
        <nav className="mt-8 flex items-center justify-between gap-4" aria-label="Listing pages">
          {result.page > 1 ? <Button variant="outline" asChild>
            <Link href={pageHref(result.page - 1)}>Previous</Link>
          </Button> : <span />}
          <span className="text-sm text-muted-foreground">Page {result.page} of {result.pages}</span>
          {result.page < result.pages ? <Button variant="outline" asChild>
            <Link href={pageHref(result.page + 1)}>Next</Link>
          </Button> : <span />}
        </nav>
      )}
    </main>
  );
}
