import { database } from "@/lib/database";
import { migrateCatalog } from "@/lib/catalog-migrations";
import { getSiteConfig } from "@/lib/site-config";
import { recordAudit } from "@/lib/audit";
import { HttpError, httpErrorResponse } from "@/lib/http-error";

migrateCatalog();

export class SeoError extends HttpError {}
export const seoErrorResponse = httpErrorResponse;

export type SeoSettings = {
  titleFormat: string;
  description: string;
  socialImage: string | null;
  googleVerification: string | null;
  bingVerification: string | null;
};

export type SeoOverrides = {
  title: string | null;
  description: string | null;
  socialImage: string | null;
  indexable: boolean | null;
};

export type SeoKind = "listing" | "article";

const emptyOverrides: SeoOverrides = {
  title: null, description: null, socialImage: null, indexable: null,
};

function optionalText(value: unknown, maximum: number, name: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || value.length > maximum || !value.trim()) {
    throw new SeoError(400, `Invalid ${name}`);
  }
  return value.trim();
}

function image(value: unknown): string | null {
  const path = optionalText(value, 2048, "social image");
  if (!path) return null;
  if (path.startsWith("/") && !path.startsWith("//") &&
      !path.includes("\\") && !/[?#]/.test(path)) return path;
  try {
    const url = new URL(path);
    if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password) {
      return url.toString();
    }
  } catch { /* invalid address */ }
  throw new SeoError(400, "Social image must be a path or public HTTP(S) URL");
}

export function parseSeoOverrides(input: unknown): SeoOverrides {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new SeoError(400, "Invalid search overrides");
  }
  const value = input as Record<string, unknown>;
  if (value.indexable !== null && value.indexable !== undefined &&
      typeof value.indexable !== "boolean") {
    throw new SeoError(400, "Invalid indexability choice");
  }
  return {
    title: optionalText(value.title, 160, "search title"),
    description: optionalText(value.description, 320, "search description"),
    socialImage: image(value.socialImage),
    indexable: value.indexable ?? null,
  };
}

export function getSeoSettings(): SeoSettings {
  const row = database.prepare("SELECT * FROM seo_settings WHERE id = 1").get() as {
    title_format: string; description: string; social_image: string | null;
    google_verification: string | null; bing_verification: string | null;
  } | undefined;
  return row ? {
    titleFormat: row.title_format, description: row.description,
    socialImage: row.social_image, googleVerification: row.google_verification,
    bingVerification: row.bing_verification,
  } : {
    titleFormat: "%s", description: getSiteConfig().description, socialImage: null,
    googleVerification: null, bingVerification: null,
  };
}

export function saveSeoSettings(input: unknown, actorId: string): SeoSettings {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new SeoError(400, "Invalid SEO settings");
  }
  const value = input as Record<string, unknown>;
  const titleFormat = value.titleFormat;
  const description = value.description;
  if (typeof titleFormat !== "string" || titleFormat.length > 200 ||
      titleFormat.split("%s").length !== 2 || !titleFormat.trim() ||
      typeof description !== "string" || !description.trim() || description.length > 320) {
    throw new SeoError(400, "Invalid title format or description");
  }
  const googleVerification = optionalText(value.googleVerification, 160, "Google verification");
  const bingVerification = optionalText(value.bingVerification, 160, "Bing verification");
  for (const token of [googleVerification, bingVerification]) {
    if (token && !/^[A-Za-z0-9._=+\/-]+$/.test(token)) {
      throw new SeoError(400, "Invalid verification value");
    }
  }
  const settings: SeoSettings = {
    titleFormat: titleFormat.trim(), description: description.trim(),
    socialImage: image(value.socialImage), googleVerification, bingVerification,
  };
  database.transaction(() => {
    database.prepare(`INSERT INTO seo_settings
      (id, title_format, description, social_image, google_verification, bing_verification, updated_at)
      VALUES (1, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET title_format = excluded.title_format,
        description = excluded.description, social_image = excluded.social_image,
        google_verification = excluded.google_verification,
        bing_verification = excluded.bing_verification, updated_at = excluded.updated_at`)
      .run(settings.titleFormat, settings.description, settings.socialImage,
        settings.googleVerification, settings.bingVerification, new Date().toISOString());
    recordAudit("seo.settings", actorId, "site");
  }).immediate();
  return settings;
}

function storedOverrides(kind: SeoKind, slug: string): {
  public_json: string | null; draft_json: string | null;
} | undefined {
  return database.prepare("SELECT public_json, draft_json FROM seo_overrides WHERE kind = ? AND slug = ?")
    .get(kind, slug) as { public_json: string | null; draft_json: string | null } | undefined;
}

export function publicSeoOverrides(kind: SeoKind, slug: string): SeoOverrides {
  const stored = storedOverrides(kind, slug)?.public_json;
  return stored ? JSON.parse(stored) as SeoOverrides : { ...emptyOverrides };
}

export function editableSeoOverrides(kind: SeoKind, slug: string): SeoOverrides {
  const row = storedOverrides(kind, slug);
  return row?.draft_json ? JSON.parse(row.draft_json) as SeoOverrides :
    row?.public_json ? JSON.parse(row.public_json) as SeoOverrides : { ...emptyOverrides };
}

export function hasDraftSeo(kind: SeoKind, slug: string): boolean {
  return Boolean(storedOverrides(kind, slug)?.draft_json);
}

export function saveDraftSeo(kind: SeoKind, slug: string, input: unknown): SeoOverrides {
  const seo = parseSeoOverrides(input);
  database.prepare(`INSERT INTO seo_overrides (kind, slug, draft_json, updated_at)
    VALUES (?, ?, ?, ?) ON CONFLICT(kind, slug) DO UPDATE SET
    draft_json = excluded.draft_json, updated_at = excluded.updated_at`)
    .run(kind, slug, JSON.stringify(seo), new Date().toISOString());
  return seo;
}

export function publishDraftSeo(kind: SeoKind, slug: string): void {
  database.prepare(`UPDATE seo_overrides SET public_json = draft_json, draft_json = NULL,
    updated_at = ? WHERE kind = ? AND slug = ? AND draft_json IS NOT NULL`)
    .run(new Date().toISOString(), kind, slug);
}
