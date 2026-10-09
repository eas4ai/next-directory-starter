import type { Metadata } from "next";

function publicUrl(path: string): string {
  const configured = process.env.SITE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const base = new URL(configured);
  if (!["http:", "https:"].includes(base.protocol) || base.username || base.password || base.search || base.hash || base.pathname !== "/") {
    throw new Error("SITE_URL must be an HTTP or HTTPS origin without a path, query, or fragment.");
  }
  return new URL(path, base).toString();
}

export function pageMetadata(path: string, title: string, description: string): Metadata {
  const url = publicUrl(path);
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { type: "website", siteName: "Directory Starter", title, description, url },
    twitter: { card: "summary", title, description },
  };
}
