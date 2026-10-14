import type { MetadataRoute } from "next";
import { connection } from "next/server";
import { publicUrl } from "@/lib/page-metadata";

export default async function robots(): Promise<MetadataRoute.Robots> {
  await connection();
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/admin/", "/owner/", "/api/"] },
    sitemap: publicUrl("/sitemap.xml"),
  };
}
