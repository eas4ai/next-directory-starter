import type { Listing } from "@/lib/listings";

export function parseListing(value: unknown): Listing | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const fields = ["slug", "name", "summary", "description", "category", "url", "status"] as const;
  if (fields.some((field) => typeof input[field] !== "string")) return null;
  const listing = Object.fromEntries(fields.map((field) => [field, input[field]])) as Listing;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(listing.slug) || listing.slug.length > 80 ||
      !listing.name.trim() || listing.name.length > 120 ||
      !listing.summary.trim() || listing.summary.length > 280 ||
      !listing.description.trim() || listing.description.length > 5000 ||
      !listing.category.trim() || listing.category.length > 80 ||
      !["draft", "published", "suspended"].includes(listing.status)) return null;
  try {
    const url = new URL(listing.url);
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname ||
        url.username || url.password || listing.url.length > 2048) return null;
  } catch {
    return null;
  }
  return listing;
}
