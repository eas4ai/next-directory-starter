import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import sharp from "sharp";
import { database } from "@/lib/database";
import { recordAudit } from "@/lib/audit";
import { HttpError, httpErrorResponse } from "@/lib/http-error";
import { drainMediaCleanupQueue, MAX_IMAGE_BYTES, mediaFilePath } from "@/lib/media";
import { getSiteConfig, parseSiteConfig, type SiteConfig } from "@/lib/site-config";
import { writeSiteSetting } from "@/lib/site-settings";

export class BrandingError extends HttpError {}
export const brandingErrorResponse = httpErrorResponse;
export type BrandAssetSlot = "logo" | "icon" | "social";

const slotField: Record<BrandAssetSlot, "logoUrl" | "iconUrl" | "socialImage"> = {
  logo: "logoUrl", icon: "iconUrl", social: "socialImage",
};
const mimeFormat: Record<string, string> = {
  "image/jpeg": "jpeg", "image/png": "png", "image/webp": "webp",
};
const brandAssetPattern = /^\/brand-assets\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.webp$/;
const queueBrandFileCleanup = database.prepare(`INSERT OR IGNORE INTO media_cleanup_queue
  (asset_id, queued_at) VALUES (?, ?)`);
const cancelBrandFileCleanup = database.prepare(
  "DELETE FROM media_cleanup_queue WHERE asset_id = ?",
);

function brandAssetIds(branding: SiteConfig): Set<string> {
  const ids = new Set<string>();
  for (const url of [branding.logoUrl, branding.iconUrl, branding.socialImage]) {
    const id = url ? brandAssetPattern.exec(url)?.[1] : undefined;
    if (id) ids.add(id);
  }
  return ids;
}

function queueUnreferencedBrandAssets(previous: SiteConfig, current: SiteConfig,
  queuedAt: string): void {
  const currentIds = brandAssetIds(current);
  for (const id of brandAssetIds(previous)) {
    if (currentIds.has(id)) continue;
    queueBrandFileCleanup.run(id, queuedAt);
  }
}

export function saveBranding(input: unknown, actorId: string): SiteConfig {
  let branding: SiteConfig;
  try { branding = parseSiteConfig(input); }
  catch (error) {
    throw new BrandingError(400, error instanceof Error ? error.message : "Invalid branding settings");
  }
  for (const url of [branding.logoUrl, branding.iconUrl, branding.socialImage]) {
    if (!url?.startsWith("/brand-assets/")) continue;
    const id = brandAssetPattern.exec(url)?.[1];
    if (!id || !existsSync(mediaFilePath(id))) {
      throw new BrandingError(400, "Uploaded brand asset is missing");
    }
  }
  database.transaction(() => {
    const previousBranding = getSiteConfig();
    const now = new Date().toISOString();
    writeSiteSetting("site_branding", JSON.stringify(branding));
    // A saved SEO row that still has the old brand default should follow the brand.
    // A distinct SEO description is an intentional override and keeps its value.
    if (branding.description !== previousBranding.description) {
      database.prepare(`UPDATE seo_settings SET description = ?, updated_at = ?
        WHERE id = 1 AND description = ?`).run(
        branding.description, now, previousBranding.description);
    }
    recordAudit("site.brand.save", actorId, "site");
    queueUnreferencedBrandAssets(previousBranding, branding, now);
  }).immediate();
  drainMediaCleanupQueue();
  return branding;
}

export async function uploadBrandAsset(slot: BrandAssetSlot, bytes: Buffer,
  mimeType: string, actorId: string): Promise<SiteConfig> {
  const field = slotField[slot];
  if (!field) throw new BrandingError(400, "Invalid brand asset slot");
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_IMAGE_BYTES) {
    throw new BrandingError(413, "Image size exceeds limit");
  }
  const expected = mimeFormat[mimeType];
  if (!expected) throw new BrandingError(400, "Unsupported image type");
  let output: Buffer;
  try {
    const image = sharp(bytes, { limitInputPixels: 4096 * 4096, failOn: "warning" });
    const metadata = await image.metadata();
    if (metadata.format !== expected || !metadata.width || !metadata.height ||
        metadata.width > 4096 || metadata.height > 4096 || (metadata.pages ?? 1) !== 1) {
      throw new BrandingError(400, "Invalid image format or dimensions");
    }
    const limit = slot === "icon" ? 256 : slot === "logo" ? 1024 : 1200;
    output = await image.rotate().resize({ width: limit, height: slot === "social" ? 630 : limit,
      fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
  } catch (error) {
    if (error instanceof BrandingError) throw error;
    throw new BrandingError(400, "Invalid image data");
  }
  const id = randomUUID();
  const file = mediaFilePath(id);
  queueBrandFileCleanup.run(id, new Date().toISOString());
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, output, { flag: "wx" });
  } catch (error) {
    drainMediaCleanupQueue();
    throw error;
  }
  let updated: SiteConfig;
  try {
    updated = database.transaction(() => {
      const previous = getSiteConfig();
      const current = parseSiteConfig({ ...previous, [field]: `/brand-assets/${id}.webp` });
      const now = new Date().toISOString();
      writeSiteSetting("site_branding", JSON.stringify(current));
      recordAudit("site.brand.upload", actorId, slot);
      queueUnreferencedBrandAssets(previous, current, now);
      cancelBrandFileCleanup.run(id);
      return current;
    }).immediate();
  } catch (error) {
    drainMediaCleanupQueue();
    throw error;
  }
  drainMediaCleanupQueue();
  return updated;
}

export function brandAssetResponse(filename: string): Response {
  const id = filename.endsWith(".webp") ? filename.slice(0, -5) : "";
  const brand = getSiteConfig();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id) ||
      ![brand.logoUrl, brand.iconUrl, brand.socialImage].includes(`/brand-assets/${id}.webp`)) {
    return new Response("Not Found", { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const bytes = readFileSync(mediaFilePath(id));
    return new Response(new Uint8Array(bytes), { headers: {
      "Content-Type": "image/webp", "Content-Length": String(bytes.length),
      "Content-Disposition": 'inline; filename="brand.webp"',
      "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
    } });
  } catch {
    return new Response("Not Found", { status: 404, headers: { "Cache-Control": "no-store" } });
  }
}
