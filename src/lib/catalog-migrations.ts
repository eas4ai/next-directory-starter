import records from "../../fixtures/sample-listings.json";
import { database } from "@/lib/database";

function insertSampleRows(): void {
  const category = database.prepare("INSERT OR IGNORE INTO categories (name) VALUES (?)");
  const listing = database.prepare(`INSERT OR IGNORE INTO listings
    (slug, name, summary, description, category, url, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  for (const record of records) {
    category.run(record.category);
    listing.run(record.slug, record.title, record.summary, record.description,
      record.category, record.url, record.status);
  }
}

const migrate = database.transaction(() => {
  database.exec(`CREATE TABLE IF NOT EXISTS catalog_migrations (
    version INTEGER PRIMARY KEY
  )`);
  const installed = database.prepare("SELECT version FROM catalog_migrations WHERE version = 1").get();
  if (installed) return;

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
  insertSampleRows();
  database.prepare("INSERT INTO catalog_migrations (version) VALUES (1)").run();
});

export function migrateCatalog(): void {
  migrate.immediate();
}

export function seedCatalog(): void {
  migrateCatalog();
  database.transaction(insertSampleRows)();
}
