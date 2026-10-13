import records from "../../fixtures/sample-listings.json";
import { parseListing } from "@/lib/catalog-input";
import { database } from "@/lib/database";
import { normalizeListingDestination } from "@/lib/listing-destinations";

function insertSampleRows(): void {
  const category = database.prepare("INSERT OR IGNORE INTO categories (name) VALUES (?)");
  const existing = database.prepare("SELECT 1 FROM listings WHERE slug = ?");
  const listing = database.prepare(`INSERT INTO listings
    (slug, name, summary, description, category, url, destination_key, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const [index, record] of records.entries()) {
    const value = parseListing({ ...record, name: record.title });
    if (!value) throw new Error(`Invalid sample listing at index ${index}.`);
    if (existing.get(value.slug)) continue;
    category.run(value.category);
    listing.run(value.slug, value.name, value.summary, value.description,
      value.category, value.url, normalizeListingDestination(value.url), value.status);
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

export function applyCatalogMigration(version: number, change: () => void): void {
  database.transaction(() => {
    const installed = database.prepare(
      "SELECT version FROM catalog_migrations WHERE version = ?",
    ).get(version);
    if (installed) return;
    change();
    database.prepare("INSERT INTO catalog_migrations (version) VALUES (?)").run(version);
  }).immediate();
}

function migratePlanModes(): void {
  // SQLite cannot relax the existing plan CHECK constraints in place. Rebuild the
  // parent table with foreign keys paused, then validate every reference before
  // committing the migration.
  database.pragma("foreign_keys = OFF");
  try {
    applyCatalogMigration(7, () => {
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
    });
  } finally {
    database.pragma("foreign_keys = ON");
  }
}

function migrateBillingProfiles(): void {
  applyCatalogMigration(8, () => {
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
  });
}

function migratePaymentLifecycle(): void {
  applyCatalogMigration(9, () => {
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
  });
}

function migratePaymentOutcomes(): void {
  applyCatalogMigration(10, () => {
    database.exec(`ALTER TABLE payment_periods ADD COLUMN provider_charge_id TEXT;
      ALTER TABLE subscription_states ADD COLUMN provider_event_at TEXT;
      CREATE UNIQUE INDEX payment_periods_charge ON payment_periods(provider, provider_charge_id)
        WHERE provider_charge_id IS NOT NULL;
      CREATE UNIQUE INDEX purchases_provider_subscription ON purchases(provider, plan_mode, provider_subscription_id)
        WHERE provider_subscription_id IS NOT NULL;`);
  });
}

function migrateArticleRevisions(): void {
  applyCatalogMigration(11, () => {
    database.exec(`ALTER TABLE articles ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
      CREATE TABLE article_revisions (
        slug TEXT PRIMARY KEY NOT NULL REFERENCES articles(slug) ON DELETE CASCADE,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        body TEXT NOT NULL,
        tags_json TEXT NOT NULL,
        saved_at TEXT NOT NULL
      );`);
  });
}

function migrateArticleCategories(): void {
  applyCatalogMigration(12, () => {
    database.exec(`CREATE TABLE article_categories (name TEXT PRIMARY KEY NOT NULL);
      ALTER TABLE articles ADD COLUMN category TEXT REFERENCES article_categories(name);
      ALTER TABLE article_revisions ADD COLUMN category TEXT REFERENCES article_categories(name);
      CREATE INDEX articles_public_category ON articles(status, category, published_at DESC, slug);`);
  });
}

function migrateMedia(): void {
  applyCatalogMigration(13, () => {
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
  });
}

function migrateNotifications(): void {
  applyCatalogMigration(14, () => {
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
  });
}

function migrateNotificationClaims(): void {
  applyCatalogMigration(15, () => {
    database.exec(`ALTER TABLE owner_notifications ADD COLUMN email_to TEXT;
      ALTER TABLE owner_notifications ADD COLUMN email_from TEXT;
      ALTER TABLE owner_notifications ADD COLUMN email_first_attempt_at TEXT;
      ALTER TABLE owner_notifications ADD COLUMN email_claim_token TEXT;
      ALTER TABLE owner_notifications ADD COLUMN email_provider_id TEXT;`);
  });
}

function migrateSeoSettings(): void {
  applyCatalogMigration(16, () => {
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
  });
}

function migrateSeoRoutes(): void {
  applyCatalogMigration(17, () => {
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
  });
}

function migrateAgentIngestion(): void {
  applyCatalogMigration(18, () => {
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
  });
}

function migrateListingRevisions(): void {
  applyCatalogMigration(19, () => {
    database.exec("ALTER TABLE listings ADD COLUMN revision INTEGER NOT NULL DEFAULT 1");
  });
}

function migrateMediaStorageSafety(): void {
  applyCatalogMigration(20, () => {
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
  });
}

function migrateAgentImportPublications(): void {
  applyCatalogMigration(23, () => {
    database.prepare(`UPDATE agent_imports
      SET published_at = COALESCE(published_at, (
            SELECT occurred_at FROM audit_events
            WHERE action = 'catalog.publish' AND target = agent_imports.slug
            ORDER BY occurred_at, id LIMIT 1
          )),
          published_by = COALESCE(published_by, (
            SELECT actor_user_id FROM audit_events
            WHERE action = 'catalog.publish' AND target = agent_imports.slug
            ORDER BY occurred_at, id LIMIT 1
          ))
      WHERE (published_at IS NULL OR published_by IS NULL)
        AND EXISTS (SELECT 1 FROM listings
          WHERE slug = agent_imports.slug AND status = 'published')
        AND EXISTS (SELECT 1 FROM audit_events
          WHERE action = 'catalog.publish' AND target = agent_imports.slug)`).run();
  });
}

type HistoricalPaddleEvidence = {
  mode: string; payload: string; received_at: string; processed_at: string | null;
};

type HistoricalPaddleRefund = {
  refundId: string; paymentId: string; amountMinor: number; currency: string;
  recordedAt: string;
};

type PaddleRefundPeriod = {
  id: string; purchase_id: string; amount_minor: number; currency: string;
  billing_mode: string;
};

function objectValue(value: unknown): Record<string, unknown> | null {
  if (value === null || Array.isArray(value) || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function historicalPaddleRefund(row: HistoricalPaddleEvidence): HistoricalPaddleRefund | null {
  let saved: Record<string, unknown> | null;
  try {
    saved = objectValue(JSON.parse(row.payload));
  } catch {
    return null;
  }
  const effect = objectValue(saved?.effect);
  if (effect?.kind !== "refund") return null;
  const paymentId = nonEmptyString(effect.paymentId);
  const currency = nonEmptyString(effect.currency)?.toLowerCase() ?? null;
  const amountMinor = effect.amountMinor;
  if (!paymentId || !currency || typeof amountMinor !== "number" ||
      !Number.isSafeInteger(amountMinor) || amountMinor <= 0) return null;
  const raw = objectValue(saved?.raw);
  const data = objectValue(raw?.data);
  let refundId = data?.action === "refund" && data.status === "approved"
    ? nonEmptyString(data.id) : null;
  const resource = nonEmptyString(raw?.resource);
  if (!refundId && resource?.endsWith(":approved")) {
    refundId = resource.slice(0, -":approved".length);
  }
  if (!refundId || refundId.length > 200) return null;
  return {
    refundId, paymentId, amountMinor, currency,
    recordedAt: row.processed_at ?? row.received_at,
  };
}

function importHistoricalPaddleRefund(mode: string, refund: HistoricalPaddleRefund): void {
  const period = database.prepare(`SELECT pp.id, pp.purchase_id, pp.amount_minor,
      pp.currency, p.billing_mode
    FROM payment_periods pp JOIN purchases p ON p.id = pp.purchase_id
    WHERE pp.provider = 'paddle' AND p.provider = 'paddle' AND p.plan_mode = ?
      AND pp.provider_payment_id = ?`).get(mode, refund.paymentId) as
      PaddleRefundPeriod | undefined;
  if (!period || refund.currency !== period.currency ||
      refund.amountMinor > period.amount_minor) return;
  const prior = database.prepare(`SELECT payment_period_id, amount_minor, currency
    FROM payment_refunds WHERE provider = 'paddle' AND provider_refund_id = ?`)
    .get(refund.refundId) as { payment_period_id: string; amount_minor: number;
      currency: string } | undefined;
  if (prior && (prior.payment_period_id !== period.id ||
      prior.amount_minor !== refund.amountMinor || prior.currency !== refund.currency)) {
    throw new Error("Conflicting historical Paddle refund evidence");
  }
  if (prior) return;
  database.prepare(`INSERT INTO payment_refunds
    (provider, provider_refund_id, payment_period_id, amount_minor, currency, recorded_at)
    VALUES ('paddle', ?, ?, ?, ?, ?)`).run(
    refund.refundId, period.id, refund.amountMinor, refund.currency, refund.recordedAt,
  );
}

function refundTotal(period: PaddleRefundPeriod): { amount: number; recordedAt: string | null } {
  const refunds = database.prepare(`SELECT amount_minor, recorded_at
    FROM payment_refunds WHERE payment_period_id = ?
    ORDER BY recorded_at, provider_refund_id`).all(period.id) as
      { amount_minor: number; recorded_at: string }[];
  let amount = 0;
  for (const refund of refunds) {
    amount = Math.min(period.amount_minor, amount + refund.amount_minor);
  }
  return { amount, recordedAt: refunds.at(-1)?.recorded_at ?? null };
}

function applyHistoricalPaddleRefunds(): Set<string> {
  const periods = database.prepare(`SELECT pp.id, pp.purchase_id, pp.amount_minor,
      pp.currency, p.billing_mode
    FROM payment_periods pp JOIN purchases p ON p.id = pp.purchase_id
    WHERE pp.provider = 'paddle'
      AND EXISTS (SELECT 1 FROM payment_refunds r WHERE r.payment_period_id = pp.id)`)
    .all() as PaddleRefundPeriod[];
  const affected = new Set<string>();
  for (const period of periods) {
    const total = refundTotal(period);
    if (total.amount < period.amount_minor) continue;
    database.prepare(`UPDATE payment_periods SET refunded_at = COALESCE(refunded_at, ?)
      WHERE id = ?`).run(total.recordedAt ?? new Date().toISOString(), period.id);
    if (period.billing_mode === "one-time") {
      database.prepare("UPDATE purchases SET status = 'refunded' WHERE id = ?")
        .run(period.purchase_id);
    }
    affected.add(period.purchase_id);
  }
  return affected;
}

function refreshHistoricalPaymentEntitlements(purchaseIds: Set<string>): void {
  const refresh = database.prepare(`UPDATE entitlements SET
      starts_at = COALESCE((SELECT MIN(starts_at) FROM payment_periods
        WHERE purchase_id = ? AND refunded_at IS NULL AND disputed_at IS NULL), starts_at),
      ends_at = COALESCE((SELECT MAX(ends_at) FROM payment_periods
        WHERE purchase_id = ? AND refunded_at IS NULL AND disputed_at IS NULL), ends_at),
      revoked_at = CASE WHEN EXISTS (SELECT 1 FROM payment_periods
        WHERE purchase_id = ? AND refunded_at IS NULL AND disputed_at IS NULL)
        THEN NULL ELSE COALESCE(revoked_at, ?) END
    WHERE purchase_id = ?`);
  for (const purchaseId of purchaseIds) {
    refresh.run(purchaseId, purchaseId, purchaseId, new Date().toISOString(), purchaseId);
  }
}

function migratePaddleRefundLedger(): void {
  applyCatalogMigration(24, () => {
    database.exec(`CREATE TABLE payment_refunds (
        provider TEXT NOT NULL,
        provider_refund_id TEXT NOT NULL,
        payment_period_id TEXT NOT NULL REFERENCES payment_periods(id) ON DELETE CASCADE,
        amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
        currency TEXT NOT NULL,
        recorded_at TEXT NOT NULL,
        PRIMARY KEY (provider, provider_refund_id)
      );
      CREATE INDEX payment_refunds_period
        ON payment_refunds(payment_period_id, recorded_at, provider_refund_id);`);

    const rows = database.prepare(`SELECT mode, payload, received_at, processed_at
      FROM payment_evidence
      WHERE provider = 'paddle' AND state = 'processed'
      ORDER BY received_at, event_id`).all() as HistoricalPaddleEvidence[];
    for (const row of rows) {
      const refund = historicalPaddleRefund(row);
      if (refund) importHistoricalPaddleRefund(row.mode, refund);
    }
    refreshHistoricalPaymentEntitlements(applyHistoricalPaddleRefunds());
  });
}

type HistoricalDisputeEvidence = {
  provider: string; mode: string; event_id: string; event_type: string;
  payload: string; received_at: string; processed_at: string | null;
};

type HistoricalDispute = {
  provider: string; disputeId: string; paymentId: string; open: boolean;
  terminal: boolean; occurredAt: string; closesPrior: boolean;
};

function validDate(value: unknown, fallback: string): string {
  const parsed = typeof value === "number" && Number.isFinite(value)
    ? value * 1000 : typeof value === "string" ? Date.parse(value) : Number.NaN;
  return new Date(Number.isFinite(parsed) ? parsed : Date.parse(fallback)).toISOString();
}

function stripeHistoricalDispute(raw: Record<string, unknown>, effect: Record<string, unknown>,
  fallback: string): HistoricalDispute | null {
  const data = objectValue(objectValue(raw.data)?.object);
  const paymentId = nonEmptyString(data?.payment_intent) ?? nonEmptyString(data?.charge) ??
    nonEmptyString(effect.paymentId);
  const disputeId = nonEmptyString(data?.id) ?? nonEmptyString(effect.disputeId);
  const status = nonEmptyString(data?.status);
  const eventType = nonEmptyString(raw.type);
  if (!paymentId || !disputeId) return null;
  const open = status ? status !== "won" : effect.open === true;
  return {
    provider: "stripe", disputeId, paymentId, open,
    terminal: eventType === "charge.dispute.closed" || status === "won" || status === "lost" ||
      effect.terminal === true,
    occurredAt: validDate(raw.created, nonEmptyString(effect.occurredAt) ?? fallback),
    closesPrior: false,
  };
}

function paddleHistoricalDispute(raw: Record<string, unknown>, effect: Record<string, unknown>,
  fallback: string): HistoricalDispute | null {
  const data = objectValue(raw.data);
  const action = nonEmptyString(data?.action);
  const status = nonEmptyString(data?.status);
  const paymentId = nonEmptyString(data?.transaction_id) ?? nonEmptyString(effect.paymentId);
  const disputeId = nonEmptyString(data?.id) ?? nonEmptyString(effect.disputeId);
  if (!paymentId || !disputeId) return null;
  const reversal = action === "chargeback_reverse" || action === "chargeback_warning_reverse";
  const closed = reversal || status === "reversed" || status === "rejected";
  return {
    provider: "paddle", disputeId, paymentId,
    open: action ? !closed : effect.open === true,
    terminal: action ? closed || status === "approved" : effect.terminal === true,
    occurredAt: validDate(raw.occurred_at, nonEmptyString(effect.occurredAt) ?? fallback),
    closesPrior: reversal || effect.closesPrior === true,
  };
}

function reconciliationHistoricalDispute(row: HistoricalDisputeEvidence,
  raw: Record<string, unknown>, effect: Record<string, unknown>,
  fallback: string): HistoricalDispute | null {
  const resource = nonEmptyString(raw.resource);
  const separator = resource?.lastIndexOf(":") ?? -1;
  const disputeId = nonEmptyString(effect.disputeId) ??
    (resource && separator > 0 ? resource.slice(0, separator) : null);
  const paymentId = nonEmptyString(effect.paymentId);
  if (!disputeId || !paymentId) return null;
  const status = resource && separator > 0 ? resource.slice(separator + 1) : null;
  const open = effect.open === true;
  return {
    provider: row.provider, disputeId, paymentId, open,
    terminal: effect.terminal === true || !open || status === "won" || status === "lost",
    occurredAt: validDate(effect.occurredAt, fallback),
    closesPrior: effect.closesPrior === true,
  };
}

function historicalDispute(row: HistoricalDisputeEvidence): HistoricalDispute | null {
  let saved: Record<string, unknown> | null;
  try {
    saved = objectValue(JSON.parse(row.payload));
  } catch {
    return null;
  }
  const effect = objectValue(saved?.effect);
  const raw = objectValue(saved?.raw);
  if (effect?.kind !== "dispute" || !raw) return null;
  const fallback = row.processed_at ?? row.received_at;
  if (row.provider === "stripe" && objectValue(objectValue(raw.data)?.object)) {
    return stripeHistoricalDispute(raw, effect, fallback);
  }
  if (row.provider === "paddle" && objectValue(raw.data)) {
    return paddleHistoricalDispute(raw, effect, fallback);
  }
  return reconciliationHistoricalDispute(row, raw, effect, fallback);
}

function importHistoricalDispute(row: HistoricalDisputeEvidence,
  dispute: HistoricalDispute): string | null {
  const periods = database.prepare(`SELECT pp.id, pp.purchase_id
    FROM payment_periods pp JOIN purchases p ON p.id = pp.purchase_id
    WHERE pp.provider = ? AND p.provider = ? AND p.plan_mode = ?
      AND (pp.provider_payment_id = ? OR pp.provider_payment_intent_id = ?
        OR pp.provider_charge_id = ?)`)
    .all(dispute.provider, dispute.provider, row.mode,
      dispute.paymentId, dispute.paymentId, dispute.paymentId) as
      { id: string; purchase_id: string }[];
  if (periods.length !== 1) return null;
  const period = periods[0];
  const prior = database.prepare(`SELECT payment_period_id, open, terminal, occurred_at
    FROM payment_disputes WHERE provider = ? AND mode = ? AND provider_dispute_id = ?`)
    .get(dispute.provider, row.mode, dispute.disputeId) as { payment_period_id: string; open: number;
      terminal: number; occurred_at: string } | undefined;
  if (prior?.payment_period_id !== undefined && prior.payment_period_id !== period.id) {
    throw new Error("Historical dispute ID belongs to multiple paid periods");
  }
  const rank = Number(dispute.terminal) * 2 + Number(dispute.open);
  const priorRank = prior ? prior.terminal * 2 + prior.open : -1;
  const newer = !prior || dispute.occurredAt > prior.occurred_at ||
    dispute.occurredAt === prior.occurred_at && rank > priorRank;
  const terminalSafe = !prior || prior.terminal !== 1 || dispute.terminal;
  if (newer && terminalSafe) {
    database.prepare(`INSERT INTO payment_disputes
      (provider, mode, provider_dispute_id, payment_period_id, open, terminal, occurred_at,
        closes_prior, recorded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider, mode, provider_dispute_id) DO UPDATE SET
        open = excluded.open, terminal = excluded.terminal,
        occurred_at = excluded.occurred_at, closes_prior = excluded.closes_prior,
        recorded_at = excluded.recorded_at`).run(
      dispute.provider, row.mode, dispute.disputeId, period.id, Number(dispute.open),
      Number(dispute.terminal), dispute.occurredAt, Number(dispute.closesPrior),
      row.processed_at ?? row.received_at,
    );
  }
  return period.purchase_id;
}

function periodHasOpenDispute(periodId: string): boolean {
  return database.prepare(`SELECT d.provider_dispute_id
    FROM payment_disputes d
    LEFT JOIN payment_disputes closed
      ON closed.payment_period_id = d.payment_period_id
      AND closed.closes_prior = 1 AND closed.occurred_at >= d.occurred_at
    WHERE d.payment_period_id = ? AND d.open = 1
      AND closed.provider_dispute_id IS NULL
    LIMIT 1`).get(periodId) !== undefined;
}

function migrateDisputeLedger(): void {
  applyCatalogMigration(25, () => {
    database.exec(`CREATE TABLE payment_disputes (
        provider TEXT NOT NULL,
        mode TEXT NOT NULL CHECK (mode IN ('test', 'live')),
        provider_dispute_id TEXT NOT NULL,
        payment_period_id TEXT NOT NULL REFERENCES payment_periods(id) ON DELETE CASCADE,
        open INTEGER NOT NULL CHECK (open IN (0, 1)),
        terminal INTEGER NOT NULL CHECK (terminal IN (0, 1)),
        occurred_at TEXT NOT NULL,
        closes_prior INTEGER NOT NULL CHECK (closes_prior IN (0, 1)),
        recorded_at TEXT NOT NULL,
        PRIMARY KEY (provider, mode, provider_dispute_id)
      );
      CREATE INDEX payment_disputes_period
        ON payment_disputes(payment_period_id, open, occurred_at);`);
    const rows = database.prepare(`SELECT provider, mode, event_id, event_type, payload,
        received_at, processed_at
      FROM payment_evidence
      WHERE provider IN ('stripe', 'paddle') AND state = 'processed'
      ORDER BY received_at, event_id`).all() as HistoricalDisputeEvidence[];
    const affected = new Set<string>();
    for (const row of rows) {
      const dispute = historicalDispute(row);
      if (!dispute) continue;
      const purchaseId = importHistoricalDispute(row, dispute);
      if (purchaseId) affected.add(purchaseId);
    }
    const periods = database.prepare(`SELECT id, purchase_id, disputed_at
      FROM payment_periods`).all() as
      { id: string; purchase_id: string; disputed_at: string | null }[];
    for (const period of periods) {
      const hasHistory = database.prepare(`SELECT 1 FROM payment_disputes
        WHERE payment_period_id = ? LIMIT 1`).get(period.id);
      if (period.disputed_at && !hasHistory) {
        database.prepare(`INSERT INTO payment_disputes
          (provider, mode, provider_dispute_id, payment_period_id, open, terminal,
            occurred_at, closes_prior, recorded_at)
          SELECT pp.provider, p.plan_mode, 'legacy:' || pp.id, pp.id, 1, 0, ?, 0, ?
          FROM payment_periods pp JOIN purchases p ON p.id = pp.purchase_id
          WHERE pp.id = ?`).run(
          period.disputed_at, new Date().toISOString(), period.id,
        );
      }
      const open = periodHasOpenDispute(period.id);
      if (open === Boolean(period.disputed_at)) continue;
      const occurredAt = open ? (database.prepare(`SELECT MAX(occurred_at) AS occurred_at
        FROM payment_disputes WHERE payment_period_id = ? AND open = 1`)
        .get(period.id) as { occurred_at: string }).occurred_at : null;
      database.prepare("UPDATE payment_periods SET disputed_at = ? WHERE id = ?")
        .run(occurredAt, period.id);
      affected.add(period.purchase_id);
    }
    refreshHistoricalPaymentEntitlements(affected);
  });
}

type HistoricalCheckoutTerminalEvidence = {
  mode: string; payload: string; received_at: string; processed_at: string | null;
};

function migrateCheckoutTerminals(): void {
  applyCatalogMigration(26, () => {
    const columns = new Set((database.prepare("PRAGMA table_info(purchases)").all() as
      { name: string }[]).map(({ name }) => name));
    if (!columns.has("checkout_terminal_state")) {
      database.exec(`ALTER TABLE purchases ADD COLUMN checkout_terminal_state TEXT
        CHECK (checkout_terminal_state IS NULL OR checkout_terminal_state IN ('expired', 'canceled'))`);
    }
    if (!columns.has("checkout_terminal_at")) {
      database.exec("ALTER TABLE purchases ADD COLUMN checkout_terminal_at TEXT");
    }
    database.exec(`CREATE INDEX IF NOT EXISTS purchases_active_checkout
      ON purchases(owner_user_id, listing_slug, provider, created_at, id)
      WHERE status = 'pending' AND billing_mode != 'free' AND checkout_terminal_state IS NULL`);

    const rows = database.prepare(`SELECT mode, payload, received_at, processed_at
      FROM payment_evidence
      WHERE provider = 'stripe' AND event_type = 'checkout.session.expired'
        AND state = 'processed'
      ORDER BY received_at, event_id`).all() as HistoricalCheckoutTerminalEvidence[];
    for (const row of rows) {
      let saved: Record<string, unknown> | null;
      try { saved = objectValue(JSON.parse(row.payload)); }
      catch { continue; }
      const raw = objectValue(saved?.raw);
      const session = objectValue(objectValue(raw?.data)?.object);
      const purchaseId = nonEmptyString(session?.client_reference_id) ??
        nonEmptyString(objectValue(session?.metadata)?.purchaseId);
      const resourceId = nonEmptyString(session?.id);
      if (!purchaseId || !resourceId || resourceId.length > 200) continue;
      const occurredAt = validDate(raw?.created, row.processed_at ?? row.received_at);
      database.prepare(`UPDATE purchases SET
          provider_resource_id = COALESCE(provider_resource_id, ?),
          stripe_session_id = CASE WHEN provider_resource_id IS NULL THEN ? ELSE stripe_session_id END,
          checkout_url = NULL, checkout_terminal_state = 'expired', checkout_terminal_at = ?
        WHERE id = ? AND provider = 'stripe' AND plan_mode = ? AND status = 'pending'
          AND checkout_terminal_state IS NULL
          AND (provider_resource_id = ? OR (provider_resource_id IS NULL
            AND checkout_request_id IS NOT NULL AND stripe_session_id = 'pending:' || id))`).run(
        resourceId, resourceId, occurredAt, purchaseId, row.mode, resourceId,
      );
    }
  });
}

function migratePaymentEvidenceRetries(): void {
  applyCatalogMigration(27, () => {
    const columns = new Set((database.prepare("PRAGMA table_info(payment_evidence)").all() as
      { name: string }[]).map(({ name }) => name));
    if (!columns.has("next_attempt_at")) {
      database.exec("ALTER TABLE payment_evidence ADD COLUMN next_attempt_at TEXT");
    }
    if (!columns.has("quarantined_at")) {
      database.exec("ALTER TABLE payment_evidence ADD COLUMN quarantined_at TEXT");
    }
    const now = new Date().toISOString();
    database.prepare(`UPDATE payment_evidence
      SET quarantined_at = ?, next_attempt_at = NULL
      WHERE state = 'unresolved' AND attempts >= 8 AND quarantined_at IS NULL`).run(now);
    database.exec(`UPDATE payment_evidence
      SET next_attempt_at = received_at
      WHERE state = 'unresolved' AND attempts < 8
        AND quarantined_at IS NULL AND next_attempt_at IS NULL;
      DROP INDEX IF EXISTS payment_evidence_unresolved;
      CREATE INDEX payment_evidence_unresolved
        ON payment_evidence(next_attempt_at, received_at, event_id)
        WHERE state = 'unresolved' AND quarantined_at IS NULL AND attempts < 8;`);
  });
}

function migratePaymentReconciliationCursors(): void {
  applyCatalogMigration(28, () => {
    database.exec(`CREATE TABLE payment_reconciliation_cursors (
        purchase_id TEXT NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
        stream TEXT NOT NULL,
        cursor TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (purchase_id, stream)
      );`);
  });
}

function migrateAgentStagingLimits(): void {
  applyCatalogMigration(29, () => {
    database.exec(`ALTER TABLE agent_imports ADD COLUMN staging_principal TEXT;
      CREATE TABLE agent_staging_usage (
        principal TEXT PRIMARY KEY NOT NULL,
        lifetime_created INTEGER NOT NULL CHECK (lifetime_created >= 0),
        window_started_at TEXT NOT NULL,
        window_created INTEGER NOT NULL CHECK (window_created >= 0),
        updated_at TEXT NOT NULL
      );`);
  });
}

function migrateListingDestinationKeys(): void {
  applyCatalogMigration(30, () => {
    const columns = new Set((database.prepare("PRAGMA table_info(listings)").all() as
      { name: string }[]).map(({ name }) => name));
    if (!columns.has("destination_key")) {
      database.exec("ALTER TABLE listings ADD COLUMN destination_key TEXT");
    }
    const rows = database.prepare(`SELECT slug, url FROM listings
      WHERE destination_key IS NULL`).all() as { slug: string; url: string }[];
    const update = database.prepare("UPDATE listings SET destination_key = ? WHERE slug = ?");
    for (const row of rows) {
      try { update.run(normalizeListingDestination(row.url), row.slug); }
      catch { /* Invalid legacy URLs cannot collide with a validated agent destination. */ }
    }
    database.exec(`CREATE INDEX IF NOT EXISTS listings_destination_key
      ON listings(destination_key)`);
  });
}

function migrateAgentKeyScopes(): void {
  applyCatalogMigration(31, () => {
    database.exec(`ALTER TABLE agent_keys ADD COLUMN scope TEXT NOT NULL DEFAULT 'publish'
      CHECK (scope IN ('stage', 'publish'))`);
  });
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
  applyCatalogMigration(21, () => {
    database.exec(`ALTER TABLE payment_periods ADD COLUMN provider_payment_intent_id TEXT;
      UPDATE payment_periods
        SET provider_payment_intent_id = provider_charge_id, provider_charge_id = NULL
        WHERE provider = 'stripe' AND provider_charge_id GLOB 'pi_*';
      CREATE UNIQUE INDEX payment_periods_payment_intent
        ON payment_periods(provider, provider_payment_intent_id)
        WHERE provider_payment_intent_id IS NOT NULL;`);
  });
  applyCatalogMigration(22, () => {
    database.exec(`ALTER TABLE submissions ADD COLUMN base_revision INTEGER
      CHECK (base_revision IS NULL OR base_revision > 0)`);
  });
  migrateAgentImportPublications();
  migratePaddleRefundLedger();
  migrateDisputeLedger();
  migrateCheckoutTerminals();
  migratePaymentEvidenceRetries();
  migratePaymentReconciliationCursors();
  migrateAgentStagingLimits();
  migrateListingDestinationKeys();
    migrateAgentKeyScopes();
}

export function seedCatalog(): void {
  migrateCatalog(true);
  database.transaction(insertSampleRows)();
}
