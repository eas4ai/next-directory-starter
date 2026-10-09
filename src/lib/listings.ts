import { database } from "@/lib/database";
import { migrateCatalog } from "@/lib/catalog-migrations";

export type Listing = {
  slug: string;
  name: string;
  summary: string;
  description: string;
  category: string;
  url: string;
  status: "published" | "draft" | "suspended";
};

export const LISTINGS_PER_PAGE = 12;

migrateCatalog();

export function publishedListingBySlug(slug: string): Listing | undefined {
  return database.prepare("SELECT * FROM listings WHERE slug = ? AND status = 'published'")
    .get(slug) as Listing | undefined;
}

export function allListings(): Listing[] {
  return database.prepare("SELECT * FROM listings ORDER BY name COLLATE NOCASE, slug")
    .all() as Listing[];
}

export function listingBySlug(slug: string): Listing | undefined {
  return database.prepare("SELECT * FROM listings WHERE slug = ?").get(slug) as Listing | undefined;
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
  const where = ["l.status = 'published'"];
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
  const listings = database.prepare(`SELECT l.* FROM listings l WHERE ${where}
    ORDER BY l.name COLLATE NOCASE, l.slug LIMIT ? OFFSET ?`)
    .all(...args, LISTINGS_PER_PAGE, (pageNumber - 1) * LISTINGS_PER_PAGE) as Listing[];
  return { listings, total, page: pageNumber, pages };
}

export function activeFeaturedListings(search: Pick<ListingSearch, "q" | "category"> = {}): Listing[] {
  const { where, args } = publicFilter(search.q ?? "", search.category ?? "");
  const now = new Date().toISOString();
  return database.prepare(`SELECT l.* FROM listings l WHERE ${where}
    AND EXISTS (SELECT 1 FROM entitlements e WHERE e.listing_slug = l.slug
      AND e.featured = 1 AND e.revoked_at IS NULL AND e.starts_at <= ? AND e.ends_at <> ?)
    ORDER BY l.name COLLATE NOCASE, l.slug LIMIT 6`).all(...args, now, now) as Listing[];
}

export function activeFeaturedSlugs(slugs: string[]): Set<string> {
  if (slugs.length === 0) return new Set();
  const placeholders = slugs.map(() => "?").join(", ");
  const now = new Date().toISOString();
  const rows = database.prepare(`SELECT DISTINCT e.listing_slug FROM entitlements e
    JOIN listings l ON l.slug = e.listing_slug AND l.status = 'published'
    WHERE e.listing_slug IN (${placeholders}) AND e.featured = 1
      AND e.revoked_at IS NULL AND e.starts_at <= ? AND e.ends_at > ?`)
    .all(...slugs, now, now) as { listing_slug: string }[];
  return new Set(rows.map((row) => row.listing_slug));
}

export function createListing(listing: Listing): void {
  database.transaction(() => {
    database.prepare("INSERT OR IGNORE INTO categories (name) VALUES (?)").run(listing.category);
    database.prepare(`INSERT INTO listings
      (slug, name, summary, description, category, url, status)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      listing.slug, listing.name, listing.summary, listing.description,
      listing.category, listing.url, listing.status,
    );
  })();
}

export function updateListing(listing: Listing): void {
  database.transaction(() => {
    database.prepare("INSERT OR IGNORE INTO categories (name) VALUES (?)").run(listing.category);
    database.prepare(`UPDATE listings SET name = ?, summary = ?, description = ?,
      category = ?, url = ?, status = ? WHERE slug = ?`).run(
      listing.name, listing.summary, listing.description, listing.category,
      listing.url, listing.status, listing.slug,
    );
  })();
}
