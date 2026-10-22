import { readSiteSetting } from "@/lib/site-settings";

export type SiteConfig = {
  name: string;
  description: string;
  logoUrl?: string;
  iconUrl?: string;
  socialImage?: string;
};

function text(name: string, fallback: string, maximum: number): string {
  const value = process.env[name]?.trim() || fallback;
  if (value.length > maximum) throw new Error(`${name} must be ${maximum} characters or fewer.`);
  return value;
}

export function parsePublicAssetUrl(input: unknown): string | undefined {
  if (input === null || input === undefined || input === "") return undefined;
  if (typeof input !== "string" || input.length > 2048 || input.trim() !== input ||
      /[\u0000-\u001f\u007f]/.test(input)) throw new Error("Invalid asset URL");
  if (/^\/(?!\/)[A-Za-z0-9._~/-]+$/.test(input) &&
      !input.split("/").some((part) => part === "." || part === "..") &&
      /\.(?:svg|png|jpe?g|webp|ico|avif)$/i.test(input)) return input;
  try {
    const url = new URL(input);
    if (["http:", "https:"].includes(url.protocol) && url.hostname &&
        !url.username && !url.password && !url.hash) return url.toString();
  } catch { /* invalid URL */ }
  throw new Error("Asset must be a public path or HTTP(S) URL without credentials or a fragment");
}

export function parseSiteConfig(input: unknown): SiteConfig {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Invalid branding settings");
  }
  const value = input as Record<string, unknown>;
  const allowed = ["name", "description", "logoUrl", "iconUrl", "socialImage"];
  if (Object.keys(value).some((key) => !allowed.includes(key)) ||
      typeof value.name !== "string" || typeof value.description !== "string") {
    throw new Error("Invalid branding settings");
  }
  const name = value.name.trim();
  const description = value.description.trim();
  if (!name || name.length > 120 || !description || description.length > 280 ||
      /[\u0000-\u001f\u007f]/.test(name + description)) {
    throw new Error("Invalid brand name or description");
  }
  return { name, description,
    logoUrl: parsePublicAssetUrl(value.logoUrl),
    iconUrl: parsePublicAssetUrl(value.iconUrl),
    socialImage: parsePublicAssetUrl(value.socialImage),
  };
}

function environmentConfig(): SiteConfig {
  return {
    name: text("SITE_NAME", "Directory Starter", 120),
    description: text("SITE_DESCRIPTION", "A curated directory of useful links.", 280),
    logoUrl: parsePublicAssetUrl(process.env.SITE_LOGO_URL?.trim()),
    iconUrl: parsePublicAssetUrl(process.env.SITE_ICON_URL?.trim()),
  };
}

export function getSiteConfig(): SiteConfig {
  const saved = readSiteSetting("site_branding");
  return saved === null ? environmentConfig() : parseSiteConfig(JSON.parse(saved));
}
