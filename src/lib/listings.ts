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

export function publishedCategories(): string[] {
  return (database.prepare("SELECT DISTINCT category FROM listings WHERE status = 'published' ORDER BY category COLLATE NOCASE")
    .all() as { category: string }[]).map((row) => row.category);
}

export type ListingSearch = { q?: string; category?: string; page?: string };

export function searchPublishedListings({ q = "", category = "", page = "1" }: ListingSearch): {
  listings: Listing[];
  total: number;
  page: number;
  pages: number;
} {
  const query = q.trim().slice(0, 120);
  const chosenCategory = category.trim().slice(0, 80);
  const requestedPage = /^\d{1,6}$/.test(page) ? Math.max(1, Number(page)) : 1;
  const where = ["status = 'published'"];
  const args: string[] = [];
  if (query) {
    const pattern = `%${query.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
    where.push("(name LIKE ? ESCAPE '\\' OR summary LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\')");
    args.push(pattern, pattern, pattern);
  }
  if (chosenCategory) {
    where.push("category = ? COLLATE NOCASE");
    args.push(chosenCategory);
  }
  const filter = where.join(" AND ");
  const total = (database.prepare(`SELECT COUNT(*) AS count FROM listings WHERE ${filter}`)
    .get(...args) as { count: number }).count;
  const pages = Math.max(1, Math.ceil(total / LISTINGS_PER_PAGE));
  const pageNumber = Math.min(requestedPage, pages);
  const listings = database.prepare(`SELECT * FROM listings WHERE ${filter}
    ORDER BY name COLLATE NOCASE, slug LIMIT ? OFFSET ?`)
    .all(...args, LISTINGS_PER_PAGE, (pageNumber - 1) * LISTINGS_PER_PAGE) as Listing[];
  return { listings, total, page: pageNumber, pages };
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
