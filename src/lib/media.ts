import { randomUUID } from "node:crypto";
import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import sharp from "sharp";
import { canAdmin, canEditArticles, canManageCatalog, canModerate } from "@/lib/admin";
import { database } from "@/lib/database";
import { DEFAULT_DATABASE_URL, parseDatabaseUrl } from "@/lib/database-url.mjs";
import { migrateCatalog } from "@/lib/catalog-migrations";
import { HttpError, httpErrorResponse } from "@/lib/http-error";
import { activeDirectoryProfiles } from "@/lib/directory-profiles";
import type { DirectoryProfileField, ProfileValueSet } from "@/lib/directory-profile-types";

migrateCatalog();

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const PRIVATE_UPLOAD_LIMIT = 30;
const PRIVATE_UPLOAD_WINDOW_MS = 60 * 60 * 1000;
export type MediaKind = "listing" | "article";
export type MediaAsset = { id: string; kind: MediaKind; slug: string; alt: string; width: number; height: number };
export class MediaError extends HttpError {}
export const mediaErrorResponse = httpErrorResponse;

const mimeFormat = {
  "image/jpeg": "jpeg", "image/png": "png", "image/webp": "webp",
} as const;

function mediaDirectory(): string {
  const databaseFile = parseDatabaseUrl(process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
    { allowMemory: process.env.NODE_ENV === "test" });
  // Runtime storage is deployed separately from the application bundle.
  return resolve(/* turbopackIgnore: true */ process.env.MEDIA_DIR?.trim() ||
    join(dirname(databaseFile), "media"));
}

export function mediaFilePath(id: string): string {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new MediaError(404, "Image not found");
  return join(mediaDirectory(), `${id}.webp`);
}

const queueMediaFileCleanup = database.prepare(`INSERT OR IGNORE INTO media_cleanup_queue
  (asset_id, queued_at) VALUES (?, ?)`);

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export function drainMediaCleanupQueue(): void {
  const queued = database.prepare(`SELECT asset_id FROM media_cleanup_queue
    ORDER BY queued_at, asset_id LIMIT 100`).all() as { asset_id: string }[];
  for (const { asset_id: id } of queued) {
    try {
      unlinkSync(mediaFilePath(id));
    } catch (error) {
      if (!isMissingFile(error)) {
        console.error(`Media cleanup deferred for ${id}`, error);
        continue;
      }
    }
    try {
      database.prepare("DELETE FROM media_cleanup_queue WHERE asset_id = ?").run(id);
    } catch (error) {
      console.error(`Media cleanup record could not be cleared for ${id}`, error);
    }
  }
}

function queueUnreferencedMediaAsset(id: string, queuedAt: string): void {
  const orphan = database.prepare(`SELECT 1 FROM media_assets a WHERE a.id = ?
    AND NOT EXISTS (SELECT 1 FROM media_assignments m WHERE m.asset_id = a.id)
    AND NOT EXISTS (SELECT 1 FROM directory_profile_media p WHERE p.asset_id = a.id)
    AND NOT EXISTS (SELECT 1 FROM directory_profile_values v WHERE v.media_id = a.id)`).get(id);
  if (!orphan) return;
  queueMediaFileCleanup.run(id, queuedAt);
  database.prepare(`DELETE FROM media_assets WHERE id = ?
    AND NOT EXISTS (SELECT 1 FROM media_assignments WHERE asset_id = ?)
    AND NOT EXISTS (SELECT 1 FROM directory_profile_media WHERE asset_id = ?)
    AND NOT EXISTS (SELECT 1 FROM directory_profile_values WHERE media_id = ?)`).run(id, id, id, id);
}

function consumePrivateUpload(actorId: string, now: string): void {
  const row = database.prepare(`SELECT window_started_at, accepted_count FROM media_upload_windows
    WHERE user_id = ?`).get(actorId) as {
      window_started_at: string; accepted_count: number;
    } | undefined;
  const nowMs = Date.parse(now);
  const startedMs = row ? Date.parse(row.window_started_at) : Number.NaN;
  if (!row || !Number.isFinite(startedMs) || startedMs > nowMs ||
      nowMs - startedMs >= PRIVATE_UPLOAD_WINDOW_MS) {
    database.prepare(`INSERT INTO media_upload_windows (user_id, window_started_at, accepted_count)
      VALUES (?, ?, 1) ON CONFLICT(user_id) DO UPDATE SET
      window_started_at = excluded.window_started_at, accepted_count = 1`).run(actorId, now);
    return;
  }
  if (row.accepted_count >= PRIVATE_UPLOAD_LIMIT) {
    throw new MediaError(429, "Private image upload limit reached; try again later");
  }
  database.prepare(`UPDATE media_upload_windows SET accepted_count = accepted_count + 1
    WHERE user_id = ?`).run(actorId);
}

drainMediaCleanupQueue();

export function ensureUploadPermission(kind: MediaKind, slug: string,
  actorId: string, actorRole: string | null | undefined): void {
  if (kind === "listing") {
    const row = database.prepare(`SELECT status FROM listings
      WHERE slug = ? AND owner_user_id = ?`).get(slug, actorId) as { status: string } | undefined;
    if (!row) throw new MediaError(404, "Listing not found");
    if (row.status === "suspended") throw new MediaError(409, "Suspended listing cannot be edited");
    if (database.prepare(`SELECT 1 FROM submissions WHERE slug = ? AND status = 'pending'`).get(slug)) {
      throw new MediaError(409, "Wait for the current review");
    }
  } else if (kind === "article") {
    if (!canEditArticles(actorRole)) throw new MediaError(403, "Article editing permission required");
    if (!database.prepare("SELECT 1 FROM articles WHERE slug = ?").get(slug)) {
      throw new MediaError(404, "Article not found");
    }
  } else {
    throw new MediaError(400, "Invalid image target");
  }
}

export async function readBoundedImage(request: Request): Promise<Buffer> {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_IMAGE_BYTES) throw new MediaError(413, "Image is too large");
  if (!request.body) throw new MediaError(400, "Image is required");
  const reader = request.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_IMAGE_BYTES) {
      await reader.cancel();
      throw new MediaError(413, "Image is too large");
    }
    chunks.push(Buffer.from(value));
  }
  if (total === 0) throw new MediaError(400, "Image is required");
  return Buffer.concat(chunks, total);
}

async function normalizePrivateImage(bytes: Buffer, mimeType: string, altInput: string): Promise<{
  output: Buffer; alt: string; width: number; height: number;
}> {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) {
    throw new MediaError(413, "Image size exceeds limit");
  }
  const expected = mimeFormat[mimeType as keyof typeof mimeFormat];
  if (!expected) throw new MediaError(400, "Unsupported image type");
  const alt = altInput.trim();
  if (!alt || alt.length > 160) throw new MediaError(400, "Image alt text is required");
  try {
    const decoder = sharp(bytes, { limitInputPixels: 4096 * 4096, failOn: "warning" });
    const metadata = await decoder.metadata();
    if (metadata.format !== expected || !metadata.width || !metadata.height ||
        metadata.width > 4096 || metadata.height > 4096 || (metadata.pages ?? 1) !== 1) {
      throw new MediaError(400, "Invalid image format or dimensions");
    }
    const { data: output, info: { width, height } } = await decoder.rotate()
      .webp({ quality: 82 }).toBuffer({ resolveWithObject: true });
    return { output, alt, width, height };
  } catch (error) {
    if (error instanceof MediaError) throw error;
    throw new MediaError(400, "Invalid image data");
  }
}

export async function uploadPrivateImage(input: {
  kind: MediaKind; slug: string; actorId: string; actorRole: string | null | undefined;
  bytes: Buffer; mimeType: string; alt: string;
}): Promise<MediaAsset> {
  ensureUploadPermission(input.kind, input.slug, input.actorId, input.actorRole);
  const { output, alt, width, height } = await normalizePrivateImage(
    input.bytes, input.mimeType, input.alt);
  const id = randomUUID();
  const directory = mediaDirectory();
  const file = mediaFilePath(id);
  const queuedAt = new Date().toISOString();
  queueMediaFileCleanup.run(id, queuedAt);
  try {
    mkdirSync(directory, { recursive: true });
    writeFileSync(file, output, { flag: "wx" });
  } catch (error) {
    drainMediaCleanupQueue();
    throw error;
  }
  try {
    database.transaction(() => {
      ensureUploadPermission(input.kind, input.slug, input.actorId, input.actorRole);
      const now = new Date().toISOString();
      consumePrivateUpload(input.actorId, now);
      const displaced = database.prepare(`SELECT asset_id FROM media_assignments
        WHERE target_kind = ? AND target_slug = ? AND slot = 'draft'`)
        .get(input.kind, input.slug) as { asset_id: string } | undefined;
      database.prepare(`INSERT INTO media_assets
        (id, target_kind, target_slug, uploaded_by, alt, width, height, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id, input.kind, input.slug, input.actorId, alt, width, height, now,
      );
      database.prepare(`INSERT INTO media_assignments (target_kind, target_slug, slot, asset_id)
        VALUES (?, ?, 'draft', ?) ON CONFLICT(target_kind, target_slug, slot)
        DO UPDATE SET asset_id = excluded.asset_id`).run(input.kind, input.slug, id);
      if (input.kind === "article") {
        const article = database.prepare("SELECT * FROM articles WHERE slug = ?")
          .get(input.slug) as { status: string; title: string; summary: string; body: string;
            category: string | null };
        if (article.status === "published") {
          const tags = database.prepare("SELECT tag_name FROM article_tags WHERE article_slug = ? ORDER BY tag_name")
            .all(input.slug) as { tag_name: string }[];
          database.prepare(`INSERT OR IGNORE INTO article_revisions
            (slug, title, summary, body, tags_json, saved_at, category)
            VALUES (?, ?, ?, ?, ?, ?, ?)`).run(input.slug, article.title, article.summary,
              article.body, JSON.stringify(tags.map((tag) => tag.tag_name)), now, article.category);
        }
        database.prepare("UPDATE articles SET revision = revision + 1 WHERE slug = ?").run(input.slug);
      } else {
        const listing = database.prepare("SELECT * FROM listings WHERE slug = ?")
          .get(input.slug) as { status: string } & Record<string, unknown>;
        if (listing.status === "published") {
          database.prepare(`INSERT OR IGNORE INTO owner_drafts
            (slug, owner_user_id, payload, updated_at) VALUES (?, ?, ?, ?)`)
            .run(input.slug, input.actorId, JSON.stringify(listing), now);
        }
      }
      if (displaced) queueUnreferencedMediaAsset(displaced.asset_id, now);
      database.prepare("DELETE FROM media_cleanup_queue WHERE asset_id = ?").run(id);
    }).immediate();
  } catch (error) {
    drainMediaCleanupQueue();
    throw error;
  }
  drainMediaCleanupQueue();
  return { id, kind: input.kind, slug: input.slug, alt, width, height };
}

function mediaField(fieldKey: string): DirectoryProfileField {
  if (!fieldKey || fieldKey.length > 160) throw new MediaError(400, "Invalid profile field");
  const field = activeDirectoryProfiles().definitions.flatMap(({ fields }) => fields)
    .find(({ key }) => key === fieldKey);
  const supportsMedia = field?.type === "media" || (field?.type === "group" &&
    (field.constraints.children as { type?: string }[]).some(({ type }) => type === "media"));
  if (!field || !supportsMedia) throw new MediaError(400, "Profile field does not accept media");
  return field;
}

function ensureProfileMediaPermission(listingSlug: string, fieldKey: string, itemId: string,
  actorUserId: string, actorRole: string | null | undefined): DirectoryProfileField {
  if (!/^[a-z0-9][a-z0-9._-]{0,119}$/i.test(itemId)) {
    throw new MediaError(400, "Invalid profile media item");
  }
  const field = mediaField(fieldKey);
  const actor = database.prepare(`SELECT role, banned, emailVerified FROM "user" WHERE id = ?`)
    .get(actorUserId) as { role: string | null; banned: number; emailVerified: number } | undefined;
  if (!actor || actor.banned || !actor.emailVerified || actor.role !== (actorRole ?? null)) {
    throw new MediaError(403, "Profile media permission required");
  }
  const listing = database.prepare("SELECT owner_user_id, status FROM listings WHERE slug = ?")
    .get(listingSlug) as { owner_user_id: string | null; status: string } | undefined;
  if (!listing) throw new MediaError(404, "Listing not found");
  if (listing.status === "suspended") throw new MediaError(409, "Suspended listing cannot be edited");
  const pending = Boolean(database.prepare(
    "SELECT 1 FROM submissions WHERE slug = ? AND status = 'pending'").get(listingSlug));
  const owner = listing.owner_user_id === actorUserId && field.writeAuthority === "owner" && !pending;
  const staff = field.writeAuthority !== "system" && (canAdmin(actor.role) ||
    (listing.owner_user_id === null && canManageCatalog(actor.role)) ||
    (pending && canModerate(actor.role)));
  if (!owner && !staff) throw new MediaError(403, "Profile media permission required");
  return field;
}

export async function uploadProfileMedia(input: {
  listingSlug: string; fieldKey: string; itemId: string; actorUserId: string;
  actorRole: string | null | undefined; bytes: Buffer; mimeType: string; alt: string;
}): Promise<MediaAsset> {
  ensureProfileMediaPermission(input.listingSlug, input.fieldKey, input.itemId,
    input.actorUserId, input.actorRole);
  const { output, alt, width, height } = await normalizePrivateImage(
    input.bytes, input.mimeType, input.alt);
  const id = randomUUID();
  const file = mediaFilePath(id);
  const queuedAt = new Date().toISOString();
  queueMediaFileCleanup.run(id, queuedAt);
  try {
    mkdirSync(mediaDirectory(), { recursive: true });
    writeFileSync(file, output, { flag: "wx" });
  } catch (error) {
    drainMediaCleanupQueue();
    throw error;
  }
  try {
    database.transaction(() => {
      ensureProfileMediaPermission(input.listingSlug, input.fieldKey, input.itemId,
        input.actorUserId, input.actorRole);
      const now = new Date().toISOString();
      consumePrivateUpload(input.actorUserId, now);
      const displaced = database.prepare(`SELECT asset_id FROM directory_profile_media
        WHERE listing_slug = ? AND field_key = ? AND item_id = ? AND state = 'draft'`)
        .get(input.listingSlug, input.fieldKey, input.itemId) as { asset_id: string } | undefined;
      if (displaced) database.prepare("DELETE FROM directory_profile_media WHERE asset_id = ?")
        .run(displaced.asset_id);
      database.prepare(`INSERT INTO media_assets
        (id, target_kind, target_slug, uploaded_by, alt, width, height, created_at)
        VALUES (?, 'listing', ?, ?, ?, ?, ?, ?)`).run(id, input.listingSlug,
        input.actorUserId, alt, width, height, now);
      database.prepare(`INSERT INTO directory_profile_media
        (asset_id, listing_slug, field_key, item_id, state, uploaded_by, created_at)
        VALUES (?, ?, ?, ?, 'draft', ?, ?)`).run(id, input.listingSlug, input.fieldKey,
        input.itemId, input.actorUserId, now);
      if (displaced) queueUnreferencedMediaAsset(displaced.asset_id, now);
      database.prepare("DELETE FROM media_cleanup_queue WHERE asset_id = ?").run(id);
    }).immediate();
  } catch (error) {
    drainMediaCleanupQueue();
    throw error;
  }
  drainMediaCleanupQueue();
  return { id, kind: "listing", slug: input.listingSlug, alt, width, height };
}

type MediaRow = { id: string; target_kind: MediaKind; target_slug: string;
  alt: string; width: number; height: number };

function fromMediaRow(row: MediaRow): MediaAsset {
  return { id: row.id, kind: row.target_kind, slug: row.target_slug,
    alt: row.alt, width: row.width, height: row.height };
}

export function assignedMedia(kind: MediaKind, slug: string, slot: "draft" | "public"): MediaAsset | undefined {
  const row = database.prepare(`SELECT a.id, a.target_kind, a.target_slug, a.alt, a.width, a.height
    FROM media_assignments m JOIN media_assets a ON a.id = m.asset_id
    WHERE m.target_kind = ? AND m.target_slug = ? AND m.slot = ?
      AND a.target_kind = m.target_kind AND a.target_slug = m.target_slug`)
    .get(kind, slug, slot) as MediaRow | undefined;
  return row ? fromMediaRow(row) : undefined;
}

export function assignedProfileMedia(listingSlug: string, fieldKey: string,
  itemId: string): MediaAsset | undefined {
  const row = database.prepare(`SELECT a.id, a.target_kind, a.target_slug, a.alt, a.width, a.height
    FROM directory_profile_media p JOIN media_assets a ON a.id = p.asset_id
    WHERE p.listing_slug = ? AND p.field_key = ? AND p.item_id = ?
    ORDER BY CASE p.state WHEN 'draft' THEN 0 ELSE 1 END LIMIT 1`)
    .get(listingSlug, fieldKey, itemId) as MediaRow | undefined;
  return row ? fromMediaRow(row) : undefined;
}

export function profileMediaIds(values: ProfileValueSet,
  profiles = activeDirectoryProfiles()): Set<string> {
  const result = new Set<string>();
  for (const definition of profiles.definitions) for (const field of definition.fields) {
    const value = values[field.key];
    if (field.type === "media") {
      if (typeof value === "string") result.add(value);
      else if (Array.isArray(value)) for (const entry of value) {
        if (entry && typeof entry === "object" && typeof (entry as { value?: unknown }).value === "string") {
          result.add((entry as { value: string }).value);
        }
      }
    } else if (field.type === "group" && Array.isArray(value)) {
      const mediaChildren = new Set((field.constraints.children as { key: string; type: string }[])
        .filter(({ type }) => type === "media").map(({ key }) => key));
      for (const entry of value) if (entry && typeof entry === "object") {
        const childValues = (entry as { values?: Record<string, unknown> }).values;
        if (!childValues) continue;
        for (const key of mediaChildren) if (typeof childValues[key] === "string") {
          result.add(childValues[key] as string);
        }
      }
    }
  }
  return result;
}

export function publicProfileMediaAssets(ids: readonly string[]): Map<string, MediaAsset> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map();
  const placeholders = unique.map(() => "?").join(", ");
  const rows = database.prepare(`SELECT DISTINCT a.id, a.target_kind, a.target_slug,
      a.alt, a.width, a.height
    FROM directory_profile_media p
    JOIN media_assets a ON a.id = p.asset_id AND a.target_kind = 'listing'
      AND a.target_slug = p.listing_slug
    JOIN listings l ON l.slug = p.listing_slug AND l.status = 'published'
    JOIN directory_profile_values v ON v.listing_slug = p.listing_slug
      AND v.field_key = p.field_key AND v.media_id = p.asset_id AND v.archived_at IS NULL
    JOIN directory_profile_state s ON s.id = 1
    WHERE p.asset_id IN (${placeholders}) AND p.state = 'public'
      AND ((v.profile_id = s.base_profile_id AND v.definition_version = s.base_profile_version)
        OR (v.profile_id = s.site_profile_id AND v.definition_version = s.site_profile_version))
      AND NOT EXISTS (SELECT 1 FROM "user" u WHERE u.id = l.owner_user_id AND u.banned = 1)`)
    .all(...unique) as MediaRow[];
  return new Map(rows.map((row) => [row.id, fromMediaRow(row)]));
}

export function promoteProfileMedia(listingSlug: string, values: ProfileValueSet): void {
  const promote = () => {
    const selected = profileMediaIds(values);
    const rows = database.prepare(`SELECT asset_id FROM directory_profile_media
      WHERE listing_slug = ? ORDER BY CASE state WHEN 'draft' THEN 0 ELSE 1 END`)
      .all(listingSlug) as { asset_id: string }[];
    const now = new Date().toISOString();
    for (const { asset_id: assetId } of rows) if (!selected.has(assetId)) {
      database.prepare("DELETE FROM directory_profile_media WHERE asset_id = ?").run(assetId);
      queueUnreferencedMediaAsset(assetId, now);
    }
    for (const assetId of selected) {
      const row = database.prepare(`SELECT field_key, item_id FROM directory_profile_media
        WHERE asset_id = ? AND listing_slug = ?`).get(assetId, listingSlug) as
        { field_key: string; item_id: string } | undefined;
      if (!row) throw new MediaError(400, "Approved profile references unavailable media");
      const displaced = database.prepare(`SELECT asset_id FROM directory_profile_media
        WHERE listing_slug = ? AND field_key = ? AND item_id = ? AND state = 'public'
          AND asset_id <> ?`).get(listingSlug, row.field_key, row.item_id, assetId) as
        { asset_id: string } | undefined;
      if (displaced) {
        database.prepare("DELETE FROM directory_profile_media WHERE asset_id = ?")
          .run(displaced.asset_id);
        queueUnreferencedMediaAsset(displaced.asset_id, now);
      }
      database.prepare("UPDATE directory_profile_media SET state = 'public' WHERE asset_id = ?")
        .run(assetId);
    }
  };
  if (database.inTransaction) promote();
  else {
    database.transaction(promote).immediate();
    drainMediaCleanupQueue();
  }
}

export function promoteDraftMedia(kind: MediaKind, slug: string): void {
  const promote = () => {
    const draft = assignedMedia(kind, slug, "draft");
    if (!draft) return;
    const displaced = database.prepare(`SELECT asset_id FROM media_assignments
      WHERE target_kind = ? AND target_slug = ? AND slot = 'public'`)
      .get(kind, slug) as { asset_id: string } | undefined;
    database.prepare(`INSERT INTO media_assignments (target_kind, target_slug, slot, asset_id)
      VALUES (?, ?, 'public', ?) ON CONFLICT(target_kind, target_slug, slot)
      DO UPDATE SET asset_id = excluded.asset_id`).run(kind, slug, draft.id);
    database.prepare(`DELETE FROM media_assignments
      WHERE target_kind = ? AND target_slug = ? AND slot = 'draft'`).run(kind, slug);
    if (displaced && displaced.asset_id !== draft.id) {
      queueUnreferencedMediaAsset(displaced.asset_id, new Date().toISOString());
    }
  };
  if (database.inTransaction) {
    promote();
    return;
  }
  database.transaction(promote).immediate();
  drainMediaCleanupQueue();
}

export function privateMediaAsset(id: string, actorId: string,
  actorRole: string | null | undefined): MediaAsset {
  const row = database.prepare(`SELECT id, target_kind, target_slug, alt, width, height
    FROM media_assets WHERE id = ?`).get(id) as MediaRow | undefined;
  if (!row) throw new MediaError(404, "Image not found");
  if (row.target_kind === "listing") {
    const listing = database.prepare("SELECT owner_user_id FROM listings WHERE slug = ?")
      .get(row.target_slug) as { owner_user_id: string | null } | undefined;
    const pending = Boolean(database.prepare(`SELECT 1 FROM submissions
      WHERE slug = ? AND status = 'pending'`).get(row.target_slug));
    const staffAccess = canAdmin(actorRole) ||
      (listing?.owner_user_id === null && canManageCatalog(actorRole)) ||
      (pending && canModerate(actorRole));
    if (!listing || (listing.owner_user_id !== actorId && !staffAccess)) {
      throw new MediaError(404, "Image not found");
    }
  } else if (!canEditArticles(actorRole) ||
      !database.prepare("SELECT 1 FROM articles WHERE slug = ?").get(row.target_slug)) {
    throw new MediaError(404, "Image not found");
  }
  return fromMediaRow(row);
}

export function publicMediaAsset(id: string): MediaAsset | undefined {
  let row = database.prepare(`SELECT a.id, a.target_kind, a.target_slug, a.alt, a.width, a.height
    FROM media_assignments m JOIN media_assets a ON a.id = m.asset_id
    WHERE a.id = ? AND m.slot = 'public' AND a.target_kind = m.target_kind
      AND a.target_slug = m.target_slug`).get(id) as MediaRow | undefined;
  if (!row) row = database.prepare(`SELECT a.id, a.target_kind, a.target_slug, a.alt, a.width, a.height
    FROM directory_profile_media p
    JOIN media_assets a ON a.id = p.asset_id AND a.target_kind = 'listing'
      AND a.target_slug = p.listing_slug
    JOIN listings l ON l.slug = p.listing_slug AND l.status = 'published'
    JOIN directory_profile_values v ON v.listing_slug = p.listing_slug
      AND v.field_key = p.field_key AND v.media_id = p.asset_id AND v.archived_at IS NULL
    JOIN directory_profile_state s ON s.id = 1
    WHERE p.asset_id = ? AND p.state = 'public'
      AND ((v.profile_id = s.base_profile_id AND v.definition_version = s.base_profile_version)
        OR (v.profile_id = s.site_profile_id AND v.definition_version = s.site_profile_version))
      AND NOT EXISTS (SELECT 1 FROM "user" u WHERE u.id = l.owner_user_id AND u.banned = 1)
    LIMIT 1`).get(id) as MediaRow | undefined;
  if (!row) return undefined;
  const eligible = row.target_kind === "listing"
    ? database.prepare(`SELECT 1 FROM listings l WHERE l.slug = ? AND l.status = 'published'
      AND NOT EXISTS (SELECT 1 FROM "user" u WHERE u.id = l.owner_user_id AND u.banned = 1)`)
      .get(row.target_slug)
    : database.prepare("SELECT 1 FROM articles WHERE slug = ? AND status = 'published'")
      .get(row.target_slug);
  return eligible ? fromMediaRow(row) : undefined;
}
