import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const origin = process.env.SITE_URL ?? "http://localhost:3000";
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/admin/", "/owner/", "/api/"] },
    sitemap: `${origin}/sitemap.xml`,
  };
}
