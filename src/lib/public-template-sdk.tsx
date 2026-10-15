import type { ComponentType, ReactNode } from "react";
import type { DirectoryProfileField } from "@/lib/directory-profile-types";
import type { Listing } from "@/lib/listings";
import type { MediaAsset } from "@/lib/media";
import type { SiteConfig } from "@/lib/site-config";

export type PublicTemplateNavigationItem = {
  href: string;
  label: string;
  emphasis?: "default" | "primary";
};

export type PublicTemplateHeaderProps = {
  site: SiteConfig;
  navigation: readonly PublicTemplateNavigationItem[];
  appearanceControl: ReactNode;
  iconLibrary: string;
};

export type PublicTemplateFooterProps = {
  site: SiteConfig;
  navigation: readonly PublicTemplateNavigationItem[];
};

export type PublicTemplateHomeProps = {
  site: SiteConfig;
};

export type PublicTemplateListing = Listing & {
  featured: boolean;
};

export type PublicTemplatePagination = {
  page: number;
  pages: number;
  previousHref?: string;
  nextHref?: string;
};

export type PublicTemplateDirectoryProps = {
  title: string;
  description: string;
  total: number;
  listings: readonly PublicTemplateListing[];
  featured: readonly PublicTemplateListing[];
  fields: readonly DirectoryProfileField[];
  mediaAssets: ReadonlyMap<string, MediaAsset>;
  facets: ReactNode;
  pagination: PublicTemplatePagination;
  iconLibrary: string;
};

export type PublicTemplateListingDetailProps = {
  listing: PublicTemplateListing;
  fields: readonly DirectoryProfileField[];
  mediaAssets: ReadonlyMap<string, MediaAsset>;
  image?: MediaAsset;
  markdownHref: string;
  iconLibrary: string;
};

export type PublicTemplateComparisonProps = {
  listings: readonly PublicTemplateListing[];
  fields: readonly DirectoryProfileField[];
  mediaAssets: ReadonlyMap<string, MediaAsset>;
  message?: string;
};

export type PublicTemplateRenderers = {
  header?: ComponentType<PublicTemplateHeaderProps>;
  home?: ComponentType<PublicTemplateHomeProps>;
  directory?: ComponentType<PublicTemplateDirectoryProps>;
  listing?: ComponentType<PublicTemplateListingDetailProps>;
  comparison?: ComponentType<PublicTemplateComparisonProps>;
  footer?: ComponentType<PublicTemplateFooterProps>;
};

export type PublicTemplateDefinition = {
  id: string;
  name: string;
  supportedProfiles?: readonly { id: string; range: string }[];
  renderers: PublicTemplateRenderers;
};

export function definePublicTemplate(definition: PublicTemplateDefinition): PublicTemplateDefinition {
  if (!/^[a-z][a-z0-9-]*$/.test(definition.id) || !definition.name.trim() ||
      Object.keys(definition.renderers).length === 0) {
    throw new Error("Invalid public template definition");
  }
  return definition;
}
