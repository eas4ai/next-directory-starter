import records from "../../fixtures/sample-listings.json";
import { parseListing } from "@/lib/catalog-input";
import { database } from "@/lib/database";

function insertSampleRows(): void {
  const category = database.prepare("INSERT OR IGNORE INTO categories (name) VALUES (?)");
  const existing = database.prepare("SELECT 1 FROM listings WHERE slug = ?");
  const listing = database.prepare(`INSERT INTO listings
    (slug, name, summary, description, category, url, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  for (const [index, record] of records.entries()) {
    const value = parseListing({ ...record, name: record.title });
    if (!value) throw new Error(`Invalid sample listing at index ${index}.`);
    if (existing.get(value.slug)) continue;
    category.run(value.category);
    listing.run(value.slug, value.name, value.summary, value.description,
      value.category, value.url, value.status);
  }
}

const migrate = database.transaction(() => {
  database.exec(`CREATE TABLE IF NOT EXISTS catalog_migrations (
    version INTEGER PRIMARY KEY
  )`);
  const catalogInstalled = database.prepare("SELECT version FROM catalog_migrations WHERE version = 1").get();
  if (!catalogInstalled) {
    database.exec(`CREATE TABLE categories (
    name TEXT PRIMARY KEY NOT NULL
  );
  CREATE TABLE listings (
    slug TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    summary TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL REFERENCES categories(name),
    url TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('draft', 'published', 'suspended'))
  );
  CREATE INDEX listings_public_order ON listings(status, name, slug);
  CREATE INDEX listings_public_category ON listings(status, category, name, slug);`);
    database.prepare("INSERT INTO catalog_migrations (version) VALUES (1)").run();
  }

  const reviewInstalled = database.prepare("SELECT version FROM catalog_migrations WHERE version = 2").get();
  if (!reviewInstalled) {
    database.exec(`ALTER TABLE listings ADD COLUMN owner_user_id TEXT;
    CREATE TABLE owner_drafts (
      slug TEXT PRIMARY KEY NOT NULL REFERENCES listings(slug),
      owner_user_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE submissions (
      id TEXT PRIMARY KEY NOT NULL,
      slug TEXT NOT NULL REFERENCES listings(slug),
      owner_user_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
      reason TEXT,
      submitted_at TEXT NOT NULL,
      decided_at TEXT,
      decided_by TEXT
    );
    CREATE INDEX submissions_queue ON submissions(status, submitted_at DESC);
    CREATE INDEX submissions_listing ON submissions(slug, submitted_at DESC);
    CREATE UNIQUE INDEX submissions_one_pending ON submissions(slug) WHERE status = 'pending';
    CREATE INDEX listings_owner ON listings(owner_user_id, name COLLATE NOCASE);`);
    database.prepare("INSERT INTO catalog_migrations (version) VALUES (2)").run();
  }
});

export function migrateCatalog(): void {
  migrate.immediate();
}

export function seedCatalog(): void {
  migrateCatalog();
  database.transaction(insertSampleRows)();
}
