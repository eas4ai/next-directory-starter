import type { Listing } from "@/lib/listings";
import type { Article } from "@/lib/articles";
import { activeDirectoryProfiles } from "@/lib/directory-profiles";
import type {
  DirectoryProfileField, ProfileChildField, ProfileGroupItem, ProfileLocation,
  ProfileMoney, ProfileRepeatedValue,
} from "@/lib/directory-profile-types";
import {
  profileMediaIds, publicProfileMediaAssets, type MediaAsset,
} from "@/lib/media";
import { publicUrl } from "@/lib/page-metadata";

const plain = (value: string): string => value.replace(/([\\`*_{}\[\]()#+.!|>~-])/g, "\\$1");
type ProfileField = DirectoryProfileField | ProfileChildField;

function choiceLabel(field: ProfileField, value: string): string {
  const choices = field.constraints.choices as { value: string; label: string }[] | undefined;
  return choices?.find((choice) => choice.value === value)?.label ?? value;
}

function profileChoice(field: ProfileField, value: unknown): string {
  if (field.type === "single-choice" && typeof value === "string") return choiceLabel(field, value);
  if (field.type !== "multiple-choice" || !Array.isArray(value)) return "";
  return value.map((item) => typeof item === "string" ? choiceLabel(field, item) : "")
    .filter(Boolean).join(", ");
}

function profileStructured(field: ProfileField, value: unknown,
  mediaAssets: ReadonlyMap<string, MediaAsset>): string {
  if (field.type === "money" && typeof value === "object") {
    const item = value as ProfileMoney;
    return `${item.currency} ${(item.amountMinor / 100).toFixed(2)}`;
  }
  if (field.type === "date-range" && typeof value === "object") {
    const range = value as { start: string; end: string };
    return `${range.start} – ${range.end}`;
  }
  if (field.type === "location" && typeof value === "object") {
    const place = value as ProfileLocation;
    return [place.locality, place.region, place.countryCode].filter(Boolean).join(", ");
  }
  if (field.type === "media" && typeof value === "string") {
    return mediaAssets.has(value) ? publicUrl(`/media/${value}`) : "";
  }
  return "";
}

function profileScalar(field: ProfileField, value: unknown,
  mediaAssets: ReadonlyMap<string, MediaAsset>): string {
  if (value === null || value === undefined) return "";
  if (field.type === "boolean") return value ? "Yes" : "No";
  if (field.type === "duration" && typeof value === "number") return `${value} seconds`;
  if (["single-choice", "multiple-choice"].includes(field.type)) return profileChoice(field, value);
  if (["money", "date-range", "location", "media"].includes(field.type)) {
    return profileStructured(field, value, mediaAssets);
  }
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function groupMarkdown(field: DirectoryProfileField, value: unknown,
  mediaAssets: ReadonlyMap<string, MediaAsset>): string {
  if (!Array.isArray(value)) return "";
  const children = field.constraints.children as ProfileChildField[];
  return (value as ProfileGroupItem[]).map((item) => {
    const pairs = children.map((child) => {
      const rendered = profileScalar(child, item.values[child.key], mediaAssets);
      return rendered ? `${plain(child.label)}: ${plain(rendered)}` : "";
    }).filter(Boolean);
    return pairs.length ? `- ${pairs.join("; ")}` : "";
  }).filter(Boolean).join("\n");
}

function profileValueMarkdown(field: DirectoryProfileField, value: unknown,
  mediaAssets: ReadonlyMap<string, MediaAsset>): string {
  if (field.type === "group") return groupMarkdown(field, value, mediaAssets);
  if (field.cardinality === "many" && field.type !== "multiple-choice" && Array.isArray(value)) {
    return (value as ProfileRepeatedValue[]).map((item) =>
      profileScalar(field, item.value, mediaAssets))
      .filter(Boolean).map((item) => `- ${plain(item)}`).join("\n");
  }
  const rendered = profileScalar(field, value, mediaAssets);
  return field.type === "markdown" ? rendered : plain(rendered);
}

function profileMarkdown(listing: Listing, fields: DirectoryProfileField[],
  mediaAssets: ReadonlyMap<string, MediaAsset>): string[] {
  return fields.filter((field) => field.visibility === "public" && field.placement !== "hidden" &&
    Object.hasOwn(listing.profileValues, field.key)).flatMap((field) => {
      const rendered = profileValueMarkdown(field, listing.profileValues[field.key], mediaAssets);
      return rendered ? [`## ${plain(field.label)}\n\n${rendered}`] : [];
    });
}

export function listingMarkdown(listing: Listing): string {
  const profiles = activeDirectoryProfiles();
  const fields = profiles.definitions.flatMap((definition) => definition.fields);
  const mediaAssets = publicProfileMediaAssets([...profileMediaIds(listing.profileValues, profiles)]);
  return [
    `# ${plain(listing.name)}`,
    plain(listing.summary),
    `Canonical: ${publicUrl(`/listings/${listing.slug}`)}`,
    `Category: ${plain(listing.category)}`,
    `Website: ${listing.url}`,
    listing.description,
    ...profileMarkdown(listing, fields, mediaAssets),
  ].join("\n\n") + "\n";
}

export function articleMarkdown(article: Article): string {
  return [
    `# ${plain(article.title)}`,
    plain(article.summary),
    `Canonical: ${publicUrl(`/articles/${article.slug}`)}`,
    ...(article.category ? [`Category: ${plain(article.category)}`] : []),
    ...(article.tags.length ? [`Tags: ${article.tags.map(plain).join(", ")}`] : []),
    article.body,
  ].join("\n\n") + "\n";
}

export const markdownHeaders = {
  "Content-Type": "text/markdown; charset=utf-8",
  "Cache-Control": "private, no-store, max-age=0",
  "X-Robots-Tag": "noindex, nofollow",
  "X-Content-Type-Options": "nosniff",
  "Vary": "Accept, User-Agent",
};
