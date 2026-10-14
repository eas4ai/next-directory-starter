import { database } from "@/lib/database";
import { migrateCatalog } from "@/lib/catalog-migrations";
import { recordAudit } from "@/lib/audit";
import { checkoutMode } from "@/lib/plans";
import { redirectForPath } from "@/lib/seo-redirects";
import { HttpError } from "@/lib/http-error";
import { canAdmin, canManageCatalog, canModerate } from "@/lib/admin";
import { markAgentImportChanged, markAgentImportPublished } from "@/lib/agent-imports";
import { normalizeListingDestination } from "@/lib/listing-destinations";
import { activeDirectoryProfiles, directoryProfileState } from "@/lib/directory-profiles";
import {
  profileValuesForListings, replaceListingProfileValues, validateProfileValues,
} from "@/lib/profile-values";
import type { ProfileValueSet } from "@/lib/directory-profile-types";

export type Listing = {
  slug: string;
  name: string;
  summary: string;
  description: string;
  category: string;
  url: string;
  status: "published" | "draft" | "suspended";
  revision: number;
  profileValues: ProfileValueSet;
  profileStateRevision: number;
};

export type StoredListing = Omit<Listing, "profileValues" | "profileStateRevision"> & {
  owner_user_id: string | null;
};

export const LISTINGS_PER_PAGE = 12;
export const PUBLIC_LISTING_PREDICATE = `l.status = 'published' AND NOT EXISTS (
  SELECT 1 FROM "user" owner WHERE owner.id = l.owner_user_id AND owner.banned = 1
)`;

migrateCatalog();

function hydrateOne(row: StoredListing | undefined, includePrivate: boolean): Listing | undefined {
  if (!row) return undefined;
  const values = profileValuesForListings([row.slug], { includePrivate }).get(row.slug) ?? {};
  return { ...row, profileValues: values, profileStateRevision: directoryProfileState().revision };
}

function hydrateMany(rows: StoredListing[], includePrivate: boolean): Listing[] {
  if (!rows.length) return [];
  const values = profileValuesForListings(rows.map(({ slug }) => slug), { includePrivate });
  const profileStateRevision = directoryProfileState().revision;
  return rows.map((row) => ({ ...row, profileValues: values.get(row.slug) ?? {},
    profileStateRevision }));
}

export function hydratePublicListings(rows: StoredListing[]): Listing[] {
  return hydrateMany(rows, false);
}

export function publishedListingBySlug(slug: string): Listing | undefined {
  return hydrateOne(database.prepare(`SELECT l.* FROM listings l WHERE l.slug = ? AND ${PUBLIC_LISTING_PREDICATE}`)
    .get(slug) as StoredListing | undefined, false);
}

export function allListings(operatorOnly = false): Listing[] {
  const rows = database.prepare(`SELECT * FROM listings ${operatorOnly ? "WHERE owner_user_id IS NULL" : ""}
    ORDER BY name COLLATE NOCASE, slug`)
    .all() as StoredListing[];
  return hydrateMany(rows, true);
}

export function listingBySlug(slug: string, operatorOnly = false): Listing | undefined {
  return hydrateOne(database.prepare(`SELECT * FROM listings WHERE slug = ?
    ${operatorOnly ? "AND owner_user_id IS NULL" : ""}`).get(slug) as StoredListing | undefined, true);
}

export function directoryCategories(): string[] {
  const rows = database.prepare("SELECT name FROM categories ORDER BY name COLLATE NOCASE")
    .all() as { name: string }[];
  return rows.map(({ name }) => name);
}

export type ListingSearch = { q?: string; category?: string; page?: string };

function publicFilter(q: string, category: string): { where: string; args: string[] } {
  const query = q.trim().slice(0, 120);
  const chosenCategory = category.trim().slice(0, 80);
  const where = [PUBLIC_LISTING_PREDICATE];
  const args: string[] = [];
  if (query) {
    const pattern = `%${query.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
    where.push("(l.name LIKE ? ESCAPE '\\' OR l.summary LIKE ? ESCAPE '\\' OR l.description LIKE ? ESCAPE '\\')");
    args.push(pattern, pattern, pattern);
  }
  if (chosenCategory) {
    where.push("l.category = ? COLLATE NOCASE");
    args.push(chosenCategory);
  }
  return { where: where.join(" AND "), args };
}

export function searchPublishedListings({ q = "", category = "", page = "1" }: ListingSearch): {
  listings: Listing[];
  total: number;
  page: number;
  pages: number;
} {
  const requestedPage = /^\d{1,6}$/.test(page) ? Math.max(1, Number(page)) : 1;
  const { where, args } = publicFilter(q, category);
  const total = (database.prepare(`SELECT COUNT(*) AS count FROM listings l WHERE ${where}`)
    .get(...args) as { count: number }).count;
  const pages = Math.max(1, Math.ceil(total / LISTINGS_PER_PAGE));
  const pageNumber = Math.min(requestedPage, pages);
  const rows = database.prepare(`SELECT l.* FROM listings l WHERE ${where}
    ORDER BY l.name COLLATE NOCASE, l.slug LIMIT ? OFFSET ?`)
    .all(...args, LISTINGS_PER_PAGE, (pageNumber - 1) * LISTINGS_PER_PAGE) as StoredListing[];
  const listings = hydrateMany(rows, false);
  return { listings, total, page: pageNumber, pages };
}

export function activeFeaturedSlugs(slugs: string[]): Set<string> {
  if (slugs.length === 0) return new Set();
  const placeholders = slugs.map(() => "?").join(", ");
  const now = new Date().toISOString();
  const rows = database.prepare(`SELECT DISTINCT e.listing_slug FROM entitlements e
    JOIN purchases p ON p.id = e.purchase_id AND p.plan_mode = ?
    JOIN listings l ON l.slug = e.listing_slug AND ${PUBLIC_LISTING_PREDICATE}
    WHERE e.listing_slug IN (${placeholders}) AND e.featured = 1
      AND e.revoked_at IS NULL AND e.starts_at <= ? AND e.ends_at > ?`)
    .all(checkoutMode(), ...slugs, now, now) as { listing_slug: string }[];
  return new Set(rows.map((row) => row.listing_slug));
}

export function createListing(listing: Listing, actorUserId: string): Listing {
  return database.transaction(() => {
    const profiles = activeDirectoryProfiles();
    const profileStateRevision = listing.profileStateRevision ?? 0;
    if (profileStateRevision !== profiles.state.revision) {
      throw new HttpError(409, "Directory profile changed since this listing was opened");
    }
    const values = validateProfileValues(listing.profileValues ?? {}, { profiles,
      authority: "operator", listingSlug: listing.slug, actorUserId, requireComplete: true });
    if (redirectForPath(`/listings/${listing.slug}`)) {
      throw new HttpError(409, "Listing slug is reserved by a redirect");
    }
    database.prepare("INSERT OR IGNORE INTO categories (name) VALUES (?)").run(listing.category);
    database.prepare(`INSERT INTO listings
      (slug, name, summary, description, category, url, destination_key, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      listing.slug, listing.name, listing.summary, listing.description,
      listing.category, listing.url, normalizeListingDestination(listing.url), listing.status,
    );
    replaceListingProfileValues({ listingSlug: listing.slug, values, profiles });
    recordAudit(listing.status === "published" ? "catalog.publish" : "catalog.create", actorUserId, listing.slug);
    return listingBySlug(listing.slug)!;
  }).immediate();
}

export function updateListing(listing: Listing, actorUserId: string, expectedRevision: number): Listing {
  return database.transaction(() => {
    const current = database.prepare("SELECT * FROM listings WHERE slug = ?")
      .get(listing.slug) as StoredListing | undefined;
    if (!current) throw new HttpError(404, "Listing not found");
    const actor = database.prepare(`SELECT role, banned, emailVerified
      FROM "user" WHERE id = ?`).get(actorUserId) as {
        role: string | null; banned: number; emailVerified: number;
      } | undefined;
    if (!actor || actor.banned || !actor.emailVerified || !canManageCatalog(actor.role)) {
      throw new HttpError(403, "Forbidden");
    }
    if (!canAdmin(actor.role) && current.owner_user_id !== null) {
      throw new HttpError(404, "Listing not found");
    }
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
      throw new HttpError(400, "Expected revision required");
    }
    if (current.revision !== expectedRevision) {
      throw new HttpError(409, "Listing changed since it was opened; refresh before saving");
    }
    if (!canModerate(actor.role) && (current.status === "suspended" || listing.status === "suspended")) {
      throw new HttpError(403, "Moderation permission required");
    }
    const profiles = activeDirectoryProfiles();
    if (listing.profileStateRevision !== profiles.state.revision) {
      throw new HttpError(409, "Directory profile changed since this listing was opened");
    }
    const values = validateProfileValues(listing.profileValues, { profiles,
      authority: "operator", listingSlug: listing.slug, actorUserId, requireComplete: true });
    database.prepare("INSERT OR IGNORE INTO categories (name) VALUES (?)").run(listing.category);
    database.prepare(`UPDATE listings SET name = ?, summary = ?, description = ?,
        category = ?, url = ?, destination_key = ?, status = ?, revision = revision + 1
        WHERE slug = ?`).run(
      listing.name, listing.summary, listing.description, listing.category,
        listing.url, normalizeListingDestination(listing.url), listing.status, listing.slug,
    );
    markAgentImportChanged(listing.slug);
    replaceListingProfileValues({ listingSlug: listing.slug, values, profiles });
    const action = listing.status === "published" && current.status !== "published"
      ? "catalog.publish" : current.status === "published" && listing.status === "draft"
        ? "catalog.unpublish" : listing.status === "suspended" && current.status !== "suspended"
          ? "catalog.suspend" : "catalog.update";
    if (action === "catalog.publish") markAgentImportPublished(actorUserId, listing.slug);
    recordAudit(action, actorUserId, listing.slug);
    return listingBySlug(listing.slug)!;
  }).immediate();
}
