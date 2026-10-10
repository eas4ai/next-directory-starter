import type { Metadata } from "next";
import { getSiteConfig } from "@/lib/site-config";
import { getSeoSettings, type SeoOverrides } from "@/lib/seo-settings";

export function publicUrl(path: string): string {
  const configured = process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || process.env.BETTER_AUTH_URL;
  if (!configured && process.env.NODE_ENV === "production") {
    throw new Error("Set SITE_URL to the public site origin before serving production pages.");
  }
  const base = new URL(configured || "http://localhost:3000");
  if (!["http:", "https:"].includes(base.protocol) || base.username || base.password || base.search || base.hash || base.pathname !== "/") {
    throw new Error("SITE_URL must be an HTTP or HTTPS origin without a path, query, or fragment.");
  }
  return new URL(path, base).toString();
}

export function pageMetadata(path: string, title: string, description: string,
  overrides?: SeoOverrides): Metadata {
  const url = publicUrl(path);
  const site = getSiteConfig();
  const settings = getSeoSettings();
  const searchTitle = settings.titleFormat.replace("%s", overrides?.title || title);
  const searchDescription = overrides?.description || description;
  const image = overrides?.socialImage || settings.socialImage;
  const imageUrl = image?.startsWith("/") ? publicUrl(image) : image;
  return {
    title: searchTitle,
    description: searchDescription,
    alternates: { canonical: url },
    openGraph: { type: "website", siteName: site.name, title: searchTitle,
      description: searchDescription, url, images: imageUrl ? [imageUrl] : undefined },
    twitter: { card: imageUrl ? "summary_large_image" : "summary", title: searchTitle,
      description: searchDescription, images: imageUrl ? [imageUrl] : undefined },
    robots: overrides?.indexable === false ? { index: false, follow: true } : undefined,
  };
}
