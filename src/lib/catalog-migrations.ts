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

  const checkoutRetryInstalled = database.prepare("SELECT version FROM catalog_migrations WHERE version = 5").get();
  if (!checkoutRetryInstalled) {
    database.exec(`ALTER TABLE purchases ADD COLUMN checkout_request_id TEXT;
    ALTER TABLE purchases ADD COLUMN stripe_product_name TEXT;
    CREATE UNIQUE INDEX purchases_checkout_request ON purchases(owner_user_id, checkout_request_id)
      WHERE checkout_request_id IS NOT NULL;`);
    database.prepare("INSERT INTO catalog_migrations (version) VALUES (5)").run();
  }

  const verificationUseInstalled = database.prepare("SELECT version FROM catalog_migrations WHERE version = 6").get();
  if (!verificationUseInstalled) {
    database.exec(`CREATE TABLE email_verification_uses (
      token_hash TEXT PRIMARY KEY NOT NULL,
      used_at TEXT NOT NULL
    );`);
    database.prepare("INSERT INTO catalog_migrations (version) VALUES (6)").run();
  }

});

function migratePlanModes(): void {
  const planModesInstalled = database.prepare("SELECT version FROM catalog_migrations WHERE version = 7").get();
  if (planModesInstalled) return;
  // SQLite cannot relax the existing plan CHECK constraints in place. Rebuild the
  // parent table with foreign keys paused, then validate every reference before
  // committing the migration.
  database.pragma("foreign_keys = OFF");
  try {
    database.transaction(() => {
      const legacyMode = process.env.BILLING_CHECKOUT_MODE === "live" ? "live" :
        process.env.BILLING_CHECKOUT_MODE === "test" ? "test" :
          process.env.STRIPE_SECRET_KEY?.startsWith("sk_live_") ? "live" : "test";
      database.exec(`CREATE TABLE publishing_plans_next (
        key TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        mode TEXT NOT NULL CHECK (mode IN ('test', 'live')),
        billing_mode TEXT NOT NULL CHECK (billing_mode IN ('free', 'one-time', 'monthly', 'annual')),
        amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
        currency TEXT NOT NULL,
        duration_days INTEGER CHECK (duration_days BETWEEN 1 AND 3650 OR duration_days IS NULL),
        featured INTEGER NOT NULL CHECK (featured IN (0, 1)),
        enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
        updated_at TEXT NOT NULL,
        CHECK ((billing_mode = 'free' AND amount_minor = 0 AND duration_days IS NULL)
          OR (billing_mode = 'one-time' AND amount_minor > 0 AND duration_days IS NOT NULL)
          OR (billing_mode IN ('monthly', 'annual') AND amount_minor > 0 AND duration_days IS NULL))
      );`);
      database.prepare(`INSERT INTO publishing_plans_next
        (key, name, description, mode, billing_mode, amount_minor, currency, duration_days,
          featured, enabled, updated_at)
        SELECT key, name, description, ?, 'one-time', amount_minor, currency, duration_days,
          featured, enabled, updated_at FROM publishing_plans`).run(legacyMode);
      database.exec(`DROP TABLE publishing_plans;
        ALTER TABLE publishing_plans_next RENAME TO publishing_plans;
        ALTER TABLE purchases ADD COLUMN plan_mode TEXT NOT NULL DEFAULT 'test';
        ALTER TABLE purchases ADD COLUMN billing_mode TEXT NOT NULL DEFAULT 'one-time';
        ALTER TABLE purchases ADD COLUMN plan_name TEXT;
        ALTER TABLE purchases ADD COLUMN plan_description TEXT;
        ALTER TABLE purchases ADD COLUMN accepted_duration_days INTEGER;`);
      database.prepare(`UPDATE purchases SET plan_mode = ?,
        plan_name = (SELECT name FROM publishing_plans WHERE key = purchases.plan_key),
        plan_description = (SELECT description FROM publishing_plans WHERE key = purchases.plan_key),
        accepted_duration_days = duration_days`)
        .run(legacyMode);
      const violations = database.pragma("foreign_key_check") as unknown[];
      if (violations.length) throw new Error("Plan migration left invalid foreign keys");
      database.prepare("INSERT INTO catalog_migrations (version) VALUES (7)").run();
    }).immediate();
  } finally {
    database.pragma("foreign_keys = ON");
  }
}

function migrateBillingProfiles(): void {
  const billingProfilesInstalled = database.prepare("SELECT version FROM catalog_migrations WHERE version = 8").get();
  if (billingProfilesInstalled) return;
  database.transaction(() => {
    database.exec(`CREATE TABLE billing_profiles (
        provider TEXT NOT NULL CHECK (provider IN ('stripe', 'paddle', 'nowpayments')),
        mode TEXT NOT NULL CHECK (mode IN ('test', 'live')),
        version INTEGER NOT NULL CHECK (version > 0),
        enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
        public_key TEXT NOT NULL,
        api_key_cipher TEXT,
        webhook_secret_cipher TEXT,
        price_mappings TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (provider, mode)
      );`);
    database.prepare("INSERT INTO catalog_migrations (version) VALUES (8)").run();
  }).immediate();
}

function migratePaymentLifecycle(): void {
  const installed = database.prepare("SELECT version FROM catalog_migrations WHERE version = 9").get();
  if (installed) return;
  database.transaction(() => {
    database.exec(`ALTER TABLE purchases ADD COLUMN provider TEXT NOT NULL DEFAULT 'stripe';
      ALTER TABLE purchases ADD COLUMN provider_resource_id TEXT;
      ALTER TABLE purchases ADD COLUMN provider_subscription_id TEXT;
      ALTER TABLE purchases ADD COLUMN provider_price_id TEXT;
      ALTER TABLE purchases ADD COLUMN checkout_url TEXT;
      CREATE UNIQUE INDEX purchases_provider_resource
        ON purchases(provider, plan_mode, provider_resource_id)
        WHERE provider_resource_id IS NOT NULL;
      CREATE TABLE payment_periods (
        id TEXT PRIMARY KEY NOT NULL,
        purchase_id TEXT NOT NULL REFERENCES purchases(id),
        provider TEXT NOT NULL,
        provider_payment_id TEXT NOT NULL,
        amount_minor INTEGER NOT NULL,
        currency TEXT NOT NULL,
        starts_at TEXT NOT NULL,
        ends_at TEXT NOT NULL,
        refunded_at TEXT,
        disputed_at TEXT,
        UNIQUE(provider, provider_payment_id)
      );
      CREATE INDEX payment_periods_purchase ON payment_periods(purchase_id, ends_at);
      CREATE TABLE payment_evidence (
        provider TEXT NOT NULL,
        mode TEXT NOT NULL CHECK (mode IN ('test', 'live')),
        event_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('pending', 'processed', 'unresolved')),
        attempts INTEGER NOT NULL DEFAULT 0,
        received_at TEXT NOT NULL,
        processed_at TEXT,
        error TEXT,
        PRIMARY KEY (provider, mode, event_id)
      );
      CREATE INDEX payment_evidence_unresolved ON payment_evidence(state, received_at);
      CREATE TABLE subscription_states (
        purchase_id TEXT PRIMARY KEY NOT NULL REFERENCES purchases(id),
        provider_subscription_id TEXT,
        state TEXT NOT NULL CHECK (state IN ('active', 'cancel-scheduled', 'canceled', 'disputed')),
        current_period_end TEXT,
        updated_at TEXT NOT NULL
      );`);
    database.prepare("INSERT INTO catalog_migrations (version) VALUES (9)").run();
  }).immediate();
}

function migratePaymentOutcomes(): void {
  if (database.prepare("SELECT version FROM catalog_migrations WHERE version = 10").get()) return;
  database.transaction(() => {
    database.exec(`ALTER TABLE payment_periods ADD COLUMN provider_charge_id TEXT;
      ALTER TABLE subscription_states ADD COLUMN provider_event_at TEXT;
      CREATE UNIQUE INDEX payment_periods_charge ON payment_periods(provider, provider_charge_id)
        WHERE provider_charge_id IS NOT NULL;
      CREATE UNIQUE INDEX purchases_provider_subscription ON purchases(provider, plan_mode, provider_subscription_id)
        WHERE provider_subscription_id IS NOT NULL;`);
    database.prepare("INSERT INTO catalog_migrations (version) VALUES (10)").run();
  }).immediate();
}

function migrateArticleRevisions(): void {
  if (database.prepare("SELECT version FROM catalog_migrations WHERE version = 11").get()) return;
  database.transaction(() => {
    database.exec(`ALTER TABLE articles ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
      CREATE TABLE article_revisions (
        slug TEXT PRIMARY KEY NOT NULL REFERENCES articles(slug) ON DELETE CASCADE,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        body TEXT NOT NULL,
        tags_json TEXT NOT NULL,
        saved_at TEXT NOT NULL
      );`);
    database.prepare("INSERT INTO catalog_migrations (version) VALUES (11)").run();
  }).immediate();
}

function migrateArticleCategories(): void {
  if (database.prepare("SELECT version FROM catalog_migrations WHERE version = 12").get()) return;
  database.transaction(() => {
    database.exec(`CREATE TABLE article_categories (name TEXT PRIMARY KEY NOT NULL);
      ALTER TABLE articles ADD COLUMN category TEXT REFERENCES article_categories(name);
      ALTER TABLE article_revisions ADD COLUMN category TEXT REFERENCES article_categories(name);
      CREATE INDEX articles_public_category ON articles(status, category, published_at DESC, slug);`);
    database.prepare("INSERT INTO catalog_migrations (version) VALUES (12)").run();
  }).immediate();
}

function migrateMedia(): void {
  if (database.prepare("SELECT version FROM catalog_migrations WHERE version = 13").get()) return;
  database.transaction(() => {
    database.exec(`CREATE TABLE media_assets (
        id TEXT PRIMARY KEY NOT NULL,
        target_kind TEXT NOT NULL CHECK (target_kind IN ('listing', 'article')),
        target_slug TEXT NOT NULL,
        uploaded_by TEXT NOT NULL,
        alt TEXT NOT NULL,
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE media_assignments (
        target_kind TEXT NOT NULL CHECK (target_kind IN ('listing', 'article')),
        target_slug TEXT NOT NULL,
        slot TEXT NOT NULL CHECK (slot IN ('draft', 'public')),
        asset_id TEXT NOT NULL REFERENCES media_assets(id),
        PRIMARY KEY (target_kind, target_slug, slot)
      );
      CREATE INDEX media_assignments_asset ON media_assignments(asset_id);`);
    database.prepare("INSERT INTO catalog_migrations (version) VALUES (13)").run();
  }).immediate();
}

function migrateNotifications(): void {
  if (database.prepare("SELECT version FROM catalog_migrations WHERE version = 14").get()) return;
  database.transaction(() => {
    database.exec(`CREATE TABLE owner_notifications (
        id TEXT PRIMARY KEY NOT NULL,
        owner_user_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        source_key TEXT NOT NULL UNIQUE,
        subject TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL,
        email_state TEXT NOT NULL DEFAULT 'pending'
          CHECK (email_state IN ('pending', 'sending', 'sent', 'failed')),
        email_attempts INTEGER NOT NULL DEFAULT 0,
        email_next_attempt_at TEXT,
        email_claimed_until TEXT,
        email_sent_at TEXT,
        email_last_error TEXT
      );
      CREATE INDEX owner_notifications_recent ON owner_notifications(owner_user_id, created_at DESC, id DESC);
      CREATE INDEX owner_notifications_delivery ON owner_notifications(email_state, email_next_attempt_at, created_at);`);
    database.prepare("INSERT INTO catalog_migrations (version) VALUES (14)").run();
  }).immediate();
}

function migrateNotificationClaims(): void {
  if (database.prepare("SELECT version FROM catalog_migrations WHERE version = 15").get()) return;
  database.transaction(() => {
    database.exec(`ALTER TABLE owner_notifications ADD COLUMN email_to TEXT;
      ALTER TABLE owner_notifications ADD COLUMN email_from TEXT;
      ALTER TABLE owner_notifications ADD COLUMN email_first_attempt_at TEXT;
      ALTER TABLE owner_notifications ADD COLUMN email_claim_token TEXT;
      ALTER TABLE owner_notifications ADD COLUMN email_provider_id TEXT;`);
    database.prepare("INSERT INTO catalog_migrations (version) VALUES (15)").run();
  }).immediate();
}

function migrateSeoSettings(): void {
  if (database.prepare("SELECT version FROM catalog_migrations WHERE version = 16").get()) return;
  database.transaction(() => {
    database.exec(`CREATE TABLE seo_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        title_format TEXT NOT NULL,
        description TEXT NOT NULL,
        social_image TEXT,
        google_verification TEXT,
        bing_verification TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE seo_overrides (
        kind TEXT NOT NULL CHECK (kind IN ('listing', 'article')),
        slug TEXT NOT NULL,
        public_json TEXT,
        draft_json TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (kind, slug)
      );
      ALTER TABLE submissions ADD COLUMN seo_json TEXT;`);
    database.prepare("INSERT INTO catalog_migrations (version) VALUES (16)").run();
  }).immediate();
}

function migrateSeoRoutes(): void {
  if (database.prepare("SELECT version FROM catalog_migrations WHERE version = 17").get()) return;
  database.transaction(() => {
    database.exec(`CREATE TABLE seo_redirects (
        source_path TEXT PRIMARY KEY NOT NULL,
        destination_path TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE seo_not_found (
        path TEXT PRIMARY KEY NOT NULL,
        hits INTEGER NOT NULL CHECK (hits BETWEEN 1 AND 1000000),
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        last_request_id TEXT NOT NULL
      );
      CREATE INDEX seo_not_found_recent ON seo_not_found(last_seen_at DESC, path);`);
    database.prepare("INSERT INTO catalog_migrations (version) VALUES (17)").run();
  }).immediate();
}

function migrateAgentIngestion(): void {
  if (database.prepare("SELECT version FROM catalog_migrations WHERE version = 18").get()) return;
  database.transaction(() => {
    database.exec(`CREATE TABLE agent_keys (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TEXT NOT NULL,
        revoked_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX agent_keys_user ON agent_keys(user_id, created_at DESC);
      CREATE TABLE agent_imports (
        slug TEXT PRIMARY KEY NOT NULL REFERENCES listings(slug),
        actor_user_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        source_url TEXT NOT NULL,
        source_excerpt TEXT NOT NULL,
        screenshot_bytes BLOB,
        screenshot_mime TEXT,
        created_at TEXT NOT NULL,
        published_at TEXT,
        published_by TEXT,
        UNIQUE(actor_user_id, idempotency_key)
      );
      CREATE INDEX agent_imports_recent ON agent_imports(created_at DESC, slug);`);
    database.prepare("INSERT INTO catalog_migrations (version) VALUES (18)").run();
  }).immediate();
}

function migrateListingRevisions(): void {
  if (database.prepare("SELECT version FROM catalog_migrations WHERE version = 19").get()) return;
  database.transaction(() => {
    database.exec("ALTER TABLE listings ADD COLUMN revision INTEGER NOT NULL DEFAULT 1");
    database.prepare("INSERT INTO catalog_migrations (version) VALUES (19)").run();
  }).immediate();
}

function migrateMediaStorageSafety(): void {
  if (database.prepare("SELECT version FROM catalog_migrations WHERE version = 20").get()) return;
  database.transaction(() => {
    database.exec(`CREATE TABLE media_upload_windows (
        user_id TEXT PRIMARY KEY NOT NULL,
        window_started_at TEXT NOT NULL,
        accepted_count INTEGER NOT NULL CHECK (accepted_count BETWEEN 1 AND 30)
      );
      CREATE TABLE media_cleanup_queue (
        asset_id TEXT PRIMARY KEY NOT NULL,
        queued_at TEXT NOT NULL
      );`);
    const queuedAt = new Date().toISOString();
    database.prepare(`INSERT INTO media_cleanup_queue (asset_id, queued_at)
      SELECT a.id, ? FROM media_assets a
      WHERE NOT EXISTS (SELECT 1 FROM media_assignments m WHERE m.asset_id = a.id)`).run(queuedAt);
    database.exec(`DELETE FROM media_assets
      WHERE NOT EXISTS (SELECT 1 FROM media_assignments m WHERE m.asset_id = media_assets.id)`);
    database.prepare("INSERT INTO catalog_migrations (version) VALUES (20)").run();
  }).immediate();
}

export function migrateCatalog(explicit = false): void {
  if (process.env.DIRECTORY_EXPLICIT_MIGRATIONS === "1" && !explicit) return;
  migrate.immediate();
  migratePlanModes();
  migrateBillingProfiles();
  migratePaymentLifecycle();
  migratePaymentOutcomes();
  migrateArticleRevisions();
  migrateArticleCategories();
  migrateMedia();
  migrateNotifications();
  migrateNotificationClaims();
  migrateSeoSettings();
  migrateSeoRoutes();
  migrateAgentIngestion();
  migrateListingRevisions();
  migrateMediaStorageSafety();
  if (!database.prepare("SELECT version FROM catalog_migrations WHERE version = 21").get()) {
    database.transaction(() => {
      database.exec(`ALTER TABLE payment_periods ADD COLUMN provider_payment_intent_id TEXT;
        UPDATE payment_periods
          SET provider_payment_intent_id = provider_charge_id, provider_charge_id = NULL
          WHERE provider = 'stripe' AND provider_charge_id GLOB 'pi_*';
        CREATE UNIQUE INDEX payment_periods_payment_intent
          ON payment_periods(provider, provider_payment_intent_id)
          WHERE provider_payment_intent_id IS NOT NULL;`);
      database.prepare("INSERT INTO catalog_migrations (version) VALUES (21)").run();
    }).immediate();
  }
}

export function seedCatalog(): void {
  migrateCatalog(true);
  database.transaction(insertSampleRows)();
}
