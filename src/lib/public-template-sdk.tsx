import type { ComponentType, ReactNode } from "react";
import type { ActiveProfileSet, DirectoryProfileField } from "@/lib/directory-profile-types";
import type { Listing } from "@/lib/listings";
import type { MediaAsset } from "@/lib/media";
import type { SiteConfig } from "@/lib/site-config";

export const PUBLIC_TEMPLATE_API_VERSION = 1 as const;

type DeepReadonly<T> = T extends (...args: never[]) => unknown ? T
  : T extends readonly (infer Item)[] ? readonly DeepReadonly<Item>[]
    : T extends object ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> } : T;

export type PublicTemplateField = DeepReadonly<DirectoryProfileField> & {
  readonly visibility: "public";
  readonly placement: Exclude<DirectoryProfileField["placement"], "hidden">;
};

function frozenClone<T>(value: T): DeepReadonly<T> {
  if (Array.isArray(value)) return Object.freeze(value.map(frozenClone)) as DeepReadonly<T>;
  if (value && typeof value === "object") {
    const entries = Object.entries(value).map(([key, entry]) => [key, frozenClone(entry)]);
    return Object.freeze(Object.fromEntries(entries)) as DeepReadonly<T>;
  }
  return value as DeepReadonly<T>;
}

export function publicTemplateFields(profiles: ActiveProfileSet): readonly PublicTemplateField[] {
  const fields = profiles.definitions.flatMap(({ fields: definitionFields }) => definitionFields)
    .filter((field): field is DirectoryProfileField & { visibility: "public";
      placement: Exclude<DirectoryProfileField["placement"], "hidden"> } =>
      field.visibility === "public" && field.placement !== "hidden")
    .map((field) => frozenClone(field) as PublicTemplateField);
  return Object.freeze(fields);
}

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
  listings: readonly PublicTemplateListing[];
  featured: readonly PublicTemplateListing[];
  fields: readonly PublicTemplateField[];
  mediaAssets: ReadonlyMap<string, MediaAsset>;
  iconLibrary: string;
};

export type PublicTemplateListing = Listing & {
  featured: boolean;
};

export function publicTemplateListings(listings: readonly PublicTemplateListing[]):
readonly PublicTemplateListing[] {
  return Object.freeze(listings.map((listing) => frozenClone(listing))) as
    readonly PublicTemplateListing[];
}

export function publicTemplateMediaAssets(assets: ReadonlyMap<string, MediaAsset>):
ReadonlyMap<string, MediaAsset> {
  const values = new Map([...assets].map(([id, asset]) => [id, frozenClone(asset) as MediaAsset]));
  const view: ReadonlyMap<string, MediaAsset> = Object.freeze({
    get size() { return values.size; },
    get(id: string) { return values.get(id); },
    has(id: string) { return values.has(id); },
    entries() { return values.entries(); },
    keys() { return values.keys(); },
    values() { return values.values(); },
    forEach(callback: (value: MediaAsset, key: string, map: ReadonlyMap<string, MediaAsset>) => void,
      thisArg?: unknown) {
      values.forEach((value, key) => callback.call(thisArg, value, key, view));
    },
    [Symbol.iterator]() { return values[Symbol.iterator](); },
  });
  return view;
}

export type PublicTemplatePagination = {
  page: number;
  pages: number;
  previousHref?: string;
  nextHref?: string;
};

export type PublicTemplateListingCardProps = {
  listing: PublicTemplateListing;
  fields: readonly PublicTemplateField[];
  mediaAssets: ReadonlyMap<string, MediaAsset>;
  iconLibrary: string;
  highlighted?: boolean;
  compareControl?: ReactNode;
};

export type PublicTemplateFeaturedProps = {
  listings: readonly PublicTemplateListing[];
  fields: readonly PublicTemplateField[];
  mediaAssets: ReadonlyMap<string, MediaAsset>;
  iconLibrary: string;
  Card: ComponentType<PublicTemplateListingCardProps>;
};

export type PublicTemplateEmptyProps = {
  message: string;
};

export type PublicTemplatePaginationProps = {
  value: PublicTemplatePagination;
};

export type PublicTemplateDirectorySlots = {
  card?: ComponentType<PublicTemplateListingCardProps>;
  featured?: ComponentType<PublicTemplateFeaturedProps>;
  empty?: ComponentType<PublicTemplateEmptyProps>;
  pagination?: ComponentType<PublicTemplatePaginationProps>;
};

export type PublicTemplateDirectoryProps = {
  title: string;
  description: string;
  total: number;
  listings: readonly PublicTemplateListing[];
  featured: readonly PublicTemplateListing[];
  fields: readonly PublicTemplateField[];
  mediaAssets: ReadonlyMap<string, MediaAsset>;
  facets: ReactNode;
  pagination: PublicTemplatePagination;
  iconLibrary: string;
  slots?: PublicTemplateDirectorySlots;
};

export type PublicTemplateListingDetailProps = {
  listing: PublicTemplateListing;
  fields: readonly PublicTemplateField[];
  mediaAssets: ReadonlyMap<string, MediaAsset>;
  image?: MediaAsset;
  markdownHref: string;
  iconLibrary: string;
};

export type PublicTemplateComparisonProps = {
  listings: readonly PublicTemplateListing[];
  fields: readonly PublicTemplateField[];
  mediaAssets: ReadonlyMap<string, MediaAsset>;
  message?: string;
};

export type PublicTemplateRenderers = PublicTemplateDirectorySlots & {
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
