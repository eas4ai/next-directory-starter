import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = process.env.SITE_URL ?? "http://localhost:3000";
  return [
    { url: `${origin}/` },
    { url: `${origin}/listings/hidden-draft` },
  ];
}
