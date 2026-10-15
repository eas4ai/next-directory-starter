import { connection } from "next/server";
import { pageMetadata } from "@/lib/page-metadata";
import { getSiteConfig } from "@/lib/site-config";
import { JsonLd } from "@/components/json-ld";
import { publicUrl } from "@/lib/page-metadata";
import { getSeoSettings } from "@/lib/seo-settings";
import { getThemeSelection } from "@/lib/theme-selection";
import { publicTemplateDefinition } from "@/lib/public-template-registry";
import { DefaultPublicHome } from "@/components/public-template-defaults";
import { activeDirectoryProfiles } from "@/lib/directory-profiles";
import { parseProfileDirectoryQuery, searchProfileDirectory } from "@/lib/profile-discovery";
import { activeFeaturedSlugs } from "@/lib/listings";
import { profileMediaIds, publicProfileMediaAssets } from "@/lib/media";
import { getThemePreset } from "@/lib/theme";
import { publicTemplateFields, publicTemplateListings,
  publicTemplateMediaAssets } from "@/lib/public-template-sdk";

export async function generateMetadata() {
  await connection();
  const site = getSiteConfig();
  return pageMetadata("/", site.name, getSeoSettings().description);
}

export default async function Home() {
  await connection();
  const site = getSiteConfig();
  const profiles = activeDirectoryProfiles();
  const result = searchProfileDirectory(parseProfileDirectoryQuery({}, profiles));
  const featuredSlugs = activeFeaturedSlugs(result.listings.map(({ slug }) => slug));
  const listings = publicTemplateListings(result.listings.map((listing) => ({
    ...listing, featured: featuredSlugs.has(listing.slug),
  })));
  const featured = Object.freeze(listings.filter(({ featured: isFeatured }) => isFeatured));
  const mediaIds = listings.flatMap((listing) => [...profileMediaIds(listing.profileValues, profiles)]);
  const mediaAssets = publicTemplateMediaAssets(publicProfileMediaAssets(mediaIds));
  const definition = publicTemplateDefinition(getThemeSelection().templateId);
  const Renderer = definition?.renderers.home ?? DefaultPublicHome;
  return <>
    <JsonLd data={{
      "@context": "https://schema.org", "@type": "WebSite",
      name: site.name, description: site.description, url: publicUrl("/"),
    }} />
    <Renderer site={site} listings={listings} featured={featured}
      fields={publicTemplateFields(profiles)} mediaAssets={mediaAssets}
      iconLibrary={getThemePreset().iconLibrary} />
  </>;
}
