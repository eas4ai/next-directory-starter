import { randomUUID } from "node:crypto";
import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import sharp from "sharp";
import { canEditArticles, canModerate } from "@/lib/admin";
import { database } from "@/lib/database";
import { migrateCatalog } from "@/lib/catalog-migrations";
import { HttpError, httpErrorResponse } from "@/lib/http-error";

migrateCatalog();

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export type MediaKind = "listing" | "article";
export type MediaAsset = { id: string; kind: MediaKind; slug: string; alt: string; width: number; height: number };
export class MediaError extends HttpError {}
export const mediaErrorResponse = httpErrorResponse;

const mimeFormat = {
  "image/jpeg": "jpeg", "image/png": "png", "image/webp": "webp",
} as const;

function mediaDirectory(): string {
  const databaseFile = (process.env.DATABASE_URL ?? "file:./.runtime/directory.db").slice(5);
  // Runtime storage is deployed separately from the application bundle.
  return resolve(/* turbopackIgnore: true */ process.env.MEDIA_DIR?.trim() ||
    join(dirname(databaseFile), "media"));
}

export function mediaFilePath(id: string): string {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new MediaError(404, "Image not found");
  return join(mediaDirectory(), `${id}.webp`);
}

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

export async function uploadPrivateImage(input: {
  kind: MediaKind; slug: string; actorId: string; actorRole: string | null | undefined;
  bytes: Buffer; mimeType: string; alt: string;
}): Promise<MediaAsset> {
  ensureUploadPermission(input.kind, input.slug, input.actorId, input.actorRole);
  if (!Buffer.isBuffer(input.bytes) || input.bytes.length === 0 ||
      input.bytes.length > MAX_IMAGE_BYTES) throw new MediaError(413, "Image size exceeds limit");
  const expected = mimeFormat[input.mimeType as keyof typeof mimeFormat];
  if (!expected) throw new MediaError(400, "Unsupported image type");
  const alt = input.alt.trim();
  if (!alt || alt.length > 160) throw new MediaError(400, "Image alt text is required");
  let output: Buffer;
  let width: number;
  let height: number;
  try {
    const decoder = sharp(input.bytes, { limitInputPixels: 4096 * 4096, failOn: "warning" });
    const metadata = await decoder.metadata();
    if (metadata.format !== expected || !metadata.width || !metadata.height ||
        metadata.width > 4096 || metadata.height > 4096 || (metadata.pages ?? 1) !== 1) {
      throw new MediaError(400, "Invalid image format or dimensions");
    }
    ({ data: output, info: { width, height } } = await decoder.rotate().webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true }));
  } catch (error) {
    if (error instanceof MediaError) throw error;
    throw new MediaError(400, "Invalid image data");
  }
  const id = randomUUID();
  const directory = mediaDirectory();
  mkdirSync(directory, { recursive: true });
  const file = mediaFilePath(id);
  writeFileSync(file, output, { flag: "wx" });
  try {
    database.transaction(() => {
      ensureUploadPermission(input.kind, input.slug, input.actorId, input.actorRole);
      const now = new Date().toISOString();
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
    }).immediate();
  } catch (error) {
    unlinkSync(file);
    throw error;
  }
  return { id, kind: input.kind, slug: input.slug, alt, width, height };
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

export function promoteDraftMedia(kind: MediaKind, slug: string): void {
  const draft = assignedMedia(kind, slug, "draft");
  if (!draft) return;
  database.prepare(`INSERT INTO media_assignments (target_kind, target_slug, slot, asset_id)
    VALUES (?, ?, 'public', ?) ON CONFLICT(target_kind, target_slug, slot)
    DO UPDATE SET asset_id = excluded.asset_id`).run(kind, slug, draft.id);
  database.prepare(`DELETE FROM media_assignments
    WHERE target_kind = ? AND target_slug = ? AND slot = 'draft'`).run(kind, slug);
}

export function privateMediaAsset(id: string, actorId: string,
  actorRole: string | null | undefined): MediaAsset {
  const row = database.prepare(`SELECT id, target_kind, target_slug, alt, width, height
    FROM media_assets WHERE id = ?`).get(id) as MediaRow | undefined;
  if (!row) throw new MediaError(404, "Image not found");
  if (row.target_kind === "listing") {
    const listing = database.prepare("SELECT owner_user_id FROM listings WHERE slug = ?")
      .get(row.target_slug) as { owner_user_id: string | null } | undefined;
    if (!listing || (listing.owner_user_id !== actorId && !canModerate(actorRole))) {
      throw new MediaError(404, "Image not found");
    }
  } else if (!canEditArticles(actorRole) ||
      !database.prepare("SELECT 1 FROM articles WHERE slug = ?").get(row.target_slug)) {
    throw new MediaError(404, "Image not found");
  }
  return fromMediaRow(row);
}

export function publicMediaAsset(id: string): MediaAsset | undefined {
  const row = database.prepare(`SELECT a.id, a.target_kind, a.target_slug, a.alt, a.width, a.height
    FROM media_assignments m JOIN media_assets a ON a.id = m.asset_id
    WHERE a.id = ? AND m.slot = 'public' AND a.target_kind = m.target_kind
      AND a.target_slug = m.target_slug`).get(id) as MediaRow | undefined;
  if (!row) return undefined;
  const eligible = row.target_kind === "listing"
    ? database.prepare(`SELECT 1 FROM listings l WHERE l.slug = ? AND l.status = 'published'
      AND NOT EXISTS (SELECT 1 FROM "user" u WHERE u.id = l.owner_user_id AND u.banned = 1)`)
      .get(row.target_slug)
    : database.prepare("SELECT 1 FROM articles WHERE slug = ? AND status = 'published'")
      .get(row.target_slug);
  return eligible ? fromMediaRow(row) : undefined;
}
