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

  const editorialInstalled = database.prepare("SELECT version FROM catalog_migrations WHERE version = 3").get();
  if (!editorialInstalled) {
    database.exec(`CREATE TABLE articles (
      slug TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      body TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('draft', 'published')),
      author_user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      published_at TEXT
    );
    CREATE INDEX articles_public_order ON articles(status, published_at DESC, slug);
    CREATE TABLE tags (
      name TEXT PRIMARY KEY NOT NULL
    );
    CREATE TABLE article_tags (
      article_slug TEXT NOT NULL REFERENCES articles(slug) ON DELETE CASCADE,
      tag_name TEXT NOT NULL REFERENCES tags(name),
      PRIMARY KEY (article_slug, tag_name)
    );
    CREATE INDEX article_tags_by_tag ON article_tags(tag_name, article_slug);`);
    database.prepare("INSERT INTO catalog_migrations (version) VALUES (3)").run();
  }

  const commerceInstalled = database.prepare("SELECT version FROM catalog_migrations WHERE version = 4").get();
  if (!commerceInstalled) {
    database.exec(`CREATE TABLE publishing_plans (
      key TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
      currency TEXT NOT NULL,
      duration_days INTEGER NOT NULL CHECK (duration_days BETWEEN 1 AND 3650),
      featured INTEGER NOT NULL CHECK (featured IN (0, 1)),
      enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
      updated_at TEXT NOT NULL
    );
    CREATE TABLE purchases (
      id TEXT PRIMARY KEY NOT NULL,
      listing_slug TEXT NOT NULL REFERENCES listings(slug),
      owner_user_id TEXT NOT NULL,
      plan_key TEXT NOT NULL REFERENCES publishing_plans(key),
      amount_minor INTEGER NOT NULL,
      currency TEXT NOT NULL,
      duration_days INTEGER NOT NULL,
      featured INTEGER NOT NULL CHECK (featured IN (0, 1)),
      stripe_session_id TEXT NOT NULL UNIQUE,
      stripe_payment_intent_id TEXT UNIQUE,
      status TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'refunded')),
      created_at TEXT NOT NULL
    );
    CREATE INDEX purchases_listing ON purchases(listing_slug, created_at DESC);
    CREATE TABLE entitlements (
      purchase_id TEXT PRIMARY KEY NOT NULL REFERENCES purchases(id),
      listing_slug TEXT NOT NULL REFERENCES listings(slug),
      starts_at TEXT NOT NULL,
      ends_at TEXT NOT NULL,
      featured INTEGER NOT NULL CHECK (featured IN (0, 1)),
      revoked_at TEXT
    );
    CREATE INDEX entitlements_featured ON entitlements(featured, ends_at, listing_slug);
    CREATE TABLE stripe_events (
      id TEXT PRIMARY KEY NOT NULL,
      type TEXT NOT NULL,
      received_at TEXT NOT NULL
    );
    CREATE TABLE audit_events (
      id TEXT PRIMARY KEY NOT NULL,
      action TEXT NOT NULL,
      actor_user_id TEXT NOT NULL,
      target TEXT NOT NULL,
      occurred_at TEXT NOT NULL
    );
    CREATE INDEX audit_events_recent ON audit_events(occurred_at DESC, id DESC);`);
    database.prepare("INSERT INTO catalog_migrations (version) VALUES (4)").run();
  }
});

export function migrateCatalog(): void {
  migrate.immediate();
}

export function seedCatalog(): void {
  migrateCatalog();
  database.transaction(insertSampleRows)();
}
