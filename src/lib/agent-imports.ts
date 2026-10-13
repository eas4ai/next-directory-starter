import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { recordAudit } from "@/lib/audit";
import { migrateCatalog } from "@/lib/catalog-migrations";
import { parseListing } from "@/lib/catalog-input";
import { database } from "@/lib/database";
import { redirectForPath } from "@/lib/seo-redirects";

migrateCatalog();

type StagedInput = {
  idempotencyKey: string; url: string; sourceUrl: string; sourceExcerpt: string;
  name: string; summary: string; description: string; category: string;
};
export type AgentStagingPrincipal = { kind: "key" | "account"; id: string };
type ItemResult = { status: "created" | "existing" | "duplicate" | "invalid" | "limited";
  slug?: string; error?: string };
type ImportRow = { slug: string; source_url: string; source_excerpt: string;
  actor_user_id: string; created_at: string; published_at: string | null;
  name: string; summary: string; description: string; category: string; url: string;
  status: string };
export type AgentImport = { slug: string; sourceUrl: string; sourceExcerpt: string;
  actorUserId: string; createdAt: string; publishedAt: string | null;
  name: string; summary: string; description: string; category: string;
  url: string; status: string };

export class AgentImportInputError extends Error {}

export const AGENT_STAGING_LIFETIME_QUOTA = 500;
export const AGENT_STAGING_HOURLY_LIMIT = 100;

function principalKey(principal: AgentStagingPrincipal): string {
  const id = principal.id.trim();
  if (!id || id.length > 200 || !["key", "account"].includes(principal.kind)) {
    throw new AgentImportInputError("Invalid staging principal");
  }
  return `${principal.kind}:${id}`;
}

function hourStart(now: Date): string {
  return new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000).toISOString();
}

type StagingUsage = {
  lifetime_created: number; window_started_at: string; window_created: number;
};

function stagingLimit(principal: string, windowStartedAt: string): ItemResult | null {
  const usage = database.prepare(`SELECT lifetime_created, window_started_at, window_created
    FROM agent_staging_usage WHERE principal = ?`).get(principal) as StagingUsage | undefined;
  if (usage && usage.lifetime_created >= AGENT_STAGING_LIFETIME_QUOTA) {
    return { status: "limited", error: "Staging quota reached for this credential" };
  }
  if (usage?.window_started_at === windowStartedAt &&
      usage.window_created >= AGENT_STAGING_HOURLY_LIMIT) {
    return { status: "limited", error: "Hourly staging limit reached; try again next hour" };
  }
  return null;
}

function recordStagingUse(principal: string, windowStartedAt: string, now: string): void {
  database.prepare(`INSERT INTO agent_staging_usage
    (principal, lifetime_created, window_started_at, window_created, updated_at)
    VALUES (?, 1, ?, 1, ?)
    ON CONFLICT(principal) DO UPDATE SET
      lifetime_created = agent_staging_usage.lifetime_created + 1,
      window_started_at = excluded.window_started_at,
      window_created = CASE
        WHEN agent_staging_usage.window_started_at = excluded.window_started_at
          THEN agent_staging_usage.window_created + 1
        ELSE 1
      END,
      updated_at = excluded.updated_at`).run(principal, windowStartedAt, now);
}

function publicUrl(value: string): string | null {
  try {
    if (value.length > 2048) return null;
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
        !hostname.includes(".") || hostname === "localhost" ||
        hostname.endsWith(".localhost") || hostname.endsWith(".local") ||
        hostname.endsWith(".internal") || /^\d+(?:\.\d+){3}$/.test(hostname) ||
        hostname.startsWith("[") || url.port === "0") return null;
    url.hash = "";
    return url.href;
  } catch { return null; }
}

function inputFrom(value: unknown): { data?: StagedInput; error?: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { error: "Invalid item" };
  const raw = value as Record<string, unknown>;
  const fields = ["idempotencyKey", "url", "sourceUrl", "sourceExcerpt", "name",
    "summary", "description", "category"] as const;
  if (fields.some((field) => typeof raw[field] !== "string")) return { error: "Missing text field" };
  const item = Object.fromEntries(fields.map((field) => [field, (raw[field] as string).trim()])) as StagedInput;
  const url = publicUrl(item.url);
  const sourceUrl = publicUrl(item.sourceUrl);
  if (!url || !sourceUrl) return { error: "Use public HTTP(S) source and destination URLs" };
  item.url = url;
  item.sourceUrl = sourceUrl;
  if (!item.idempotencyKey || item.idempotencyKey.length > 120 ||
      !item.sourceExcerpt || item.sourceExcerpt.length > 1500 ||
      !item.name || item.name.length > 120 ||
      !item.summary || item.summary.length > 280 ||
      !item.description || item.description.length > 5000 ||
      !item.category || item.category.length > 80) return { error: "Invalid field length" };
  const category = database.prepare("SELECT 1 FROM categories WHERE name = ? COLLATE NOCASE")
    .get(item.category);
  if (!category) return { error: "Unknown category" };
  return { data: item };
}

function baseSlug(name: string): string {
  return name.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70).replace(/-$/g, "") || "resource";
}

function availableSlug(name: string): string {
  const root = baseSlug(name);
  for (let index = 0; index < 1000; index += 1) {
    const slug = index === 0 ? root : `${root}-${index + 1}`;
    if (!database.prepare("SELECT 1 FROM listings WHERE slug = ?").get(slug) &&
        !redirectForPath(`/listings/${slug}`)) return slug;
  }
  return `${root}-${randomUUID().slice(0, 8)}`;
}

function stageOne(actorUserId: string, stagingPrincipal: string, value: unknown): ItemResult {
  const parsed = inputFrom(value);
  if (!parsed.data) return { status: "invalid", error: parsed.error };
  const item = parsed.data;
  return database.transaction((): ItemResult => {
    const priorKey = database.prepare(`SELECT slug FROM agent_imports
      WHERE actor_user_id = ? AND idempotency_key = ?`)
      .get(actorUserId, item.idempotencyKey) as { slug: string } | undefined;
    if (priorKey) return { status: "existing", slug: priorKey.slug };
    let duplicate: { slug: string } | undefined;
    for (const row of database.prepare("SELECT slug, url FROM listings")
      .iterate() as Iterable<{ slug: string; url: string }>) {
      const existing = new URL(row.url);
      existing.hash = "";
      if (existing.href === item.url) {
        duplicate = row;
        break;
      }
    }
    if (duplicate) return { status: "duplicate", slug: duplicate.slug };
    const slug = availableSlug(item.name);
    const listing = parseListing({ ...item, slug, status: "draft" });
    if (!listing) return { status: "invalid", error: "Invalid listing fields" };
    const now = new Date();
    const nowText = now.toISOString();
    const windowStartedAt = hourStart(now);
    const limited = stagingLimit(stagingPrincipal, windowStartedAt);
    if (limited) return limited;
    database.prepare(`INSERT INTO listings
      (slug, name, summary, description, category, url, status)
      VALUES (?, ?, ?, ?, ?, ?, 'draft')`).run(
      slug, listing.name, listing.summary, listing.description, listing.category, listing.url);
    database.prepare(`INSERT INTO agent_imports
      (slug, actor_user_id, idempotency_key, source_url, source_excerpt, created_at,
        staging_principal)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      slug, actorUserId, item.idempotencyKey, item.sourceUrl,
      item.sourceExcerpt, nowText, stagingPrincipal);
    recordStagingUse(stagingPrincipal, windowStartedAt, nowText);
    recordAudit("catalog.import.stage", actorUserId, slug);
    return { status: "created", slug };
  }).immediate();
}

export function stageAgentImports(actorUserId: string, principal: AgentStagingPrincipal,
  items: unknown): ItemResult[] {
  if (!Array.isArray(items) || items.length < 1 || items.length > 20) {
    throw new AgentImportInputError("Provide 1 to 20 observed links.");
  }
  const stagingPrincipal = principalKey(principal);
  return items.map((item) => stageOne(actorUserId, stagingPrincipal, item));
}

export function listAgentImports(): AgentImport[] {
  const rows = database.prepare(`SELECT i.slug, i.source_url, i.source_excerpt,
    i.actor_user_id, i.created_at, i.published_at,
    l.name, l.summary, l.description, l.category, l.url, l.status
    FROM agent_imports i JOIN listings l ON l.slug = i.slug
    ORDER BY i.created_at DESC, i.slug LIMIT 100`).all() as ImportRow[];
  return rows.map((row) => ({ slug: row.slug, sourceUrl: row.source_url,
    sourceExcerpt: row.source_excerpt, actorUserId: row.actor_user_id,
    createdAt: row.created_at, publishedAt: row.published_at,
    name: row.name, summary: row.summary, description: row.description,
    category: row.category, url: row.url, status: row.status }));
}

export function markAgentImportPublished(actorUserId: string, slug: string): void {
  database.prepare(`UPDATE agent_imports SET published_at = ?, published_by = ?
    WHERE slug = ? AND published_at IS NULL`)
    .run(new Date().toISOString(), actorUserId, slug);
}

export function publishAgentImport(actorUserId: string, slug: string) {
  return database.transaction(() => {
    const row = database.prepare(`SELECT l.status FROM agent_imports i
      JOIN listings l ON l.slug = i.slug WHERE i.slug = ?`).get(slug) as { status: string } | undefined;
    if (!row) throw new Error("Import not found");
    if (row.status === "suspended") throw new Error("Suspended imports cannot be published");
    if (row.status === "published") return { slug, status: "published" };
    database.prepare(`UPDATE listings SET status = 'published', revision = revision + 1
      WHERE slug = ?`).run(slug);
    markAgentImportPublished(actorUserId, slug);
    recordAudit("catalog.publish", actorUserId, slug);
    return { slug, status: "published" };
  }).immediate();
}

export async function attachImportScreenshot(actorUserId: string, slug: string,
  mimeType: string, base64: string) {
  if (!/^image\/(jpeg|png|webp)$/.test(mimeType) ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length > 7_100_000) {
    throw new Error("Screenshot must be a JPEG, PNG, or WebP no larger than 5 MiB");
  }
  const source = Buffer.from(base64, "base64");
  if (source.length > 5 * 1024 * 1024) throw new Error("Screenshot exceeds 5 MiB");
  const image = sharp(source, { limitInputPixels: 4096 * 4096 });
  const metadata = await image.metadata();
  const expected = mimeType.split("/")[1];
  if (metadata.format !== expected || !metadata.width || !metadata.height ||
      metadata.width > 4096 || metadata.height > 4096) throw new Error("Screenshot content does not match its MIME type or dimensions");
  const sanitized = await image.rotate().png().toBuffer();
  if (sanitized.length > 5 * 1024 * 1024) throw new Error("Normalized screenshot exceeds 5 MiB");
  const changed = database.prepare(`UPDATE agent_imports
    SET screenshot_bytes = ?, screenshot_mime = 'image/png'
    WHERE slug = ? AND published_at IS NULL
      AND EXISTS (SELECT 1 FROM listings l
        WHERE l.slug = agent_imports.slug AND l.status = 'draft')`).run(sanitized, slug).changes;
  if (!changed) throw new Error("Private import not found");
  recordAudit("catalog.import.screenshot", actorUserId, slug);
  return { slug, mimeType: "image/png" };
}

export function importCardPreview(slug: string) {
  if (!database.prepare("SELECT 1 FROM agent_imports WHERE slug = ?").get(slug)) {
    throw new Error("Import not found");
  }
  return { slug, previewUrl: `/api/agent/imports/${slug}/card` };
}
