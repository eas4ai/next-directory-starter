import type { Metadata } from "next";
import { getSiteConfig } from "@/lib/site-config";

function publicUrl(path: string): string {
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

export function pageMetadata(path: string, title: string, description: string): Metadata {
  const url = publicUrl(path);
  const site = getSiteConfig();
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { type: "website", siteName: site.name, title, description, url },
    twitter: { card: "summary", title, description },
  };
}
