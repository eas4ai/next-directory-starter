export type SiteConfig = {
  name: string;
  description: string;
  logoUrl?: string;
  iconUrl?: string;
};

function text(name: string, fallback: string, maximum: number): string {
  const value = process.env[name]?.trim() || fallback;
  if (value.length > maximum) throw new Error(`${name} must be ${maximum} characters or fewer.`);
  return value;
}

function asset(name: string): string | undefined {
  const value = process.env[name]?.trim();
  if (!value) return undefined;
  if (value.startsWith("/") && !value.startsWith("//") && !value.includes("\\")) return value;
  try {
    const url = new URL(value);
    if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password) return url.toString();
  } catch { /* invalid URL */ }
  throw new Error(`${name} must be a site-relative path or an HTTP(S) URL without credentials.`);
}

export function getSiteConfig(): SiteConfig {
  return {
    name: text("SITE_NAME", "Directory Starter", 120),
    description: text("SITE_DESCRIPTION", "A curated directory of useful links.", 280),
    logoUrl: asset("SITE_LOGO_URL"),
    iconUrl: asset("SITE_ICON_URL"),
  };
}
