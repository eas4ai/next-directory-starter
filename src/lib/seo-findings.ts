import { database } from "@/lib/database";
import { migrateCatalog } from "@/lib/catalog-migrations";
import { publishedListingBySlug, PUBLIC_LISTING_PREDICATE } from "@/lib/listings";
import { publishedArticleBySlug } from "@/lib/articles";
import { getSeoSettings, publicSeoOverrides, type SeoOverrides } from "@/lib/seo-settings";
import { getSiteConfig } from "@/lib/site-config";
import { pageMetadata, publicUrl } from "@/lib/page-metadata";
import { HttpError } from "@/lib/http-error";
import { assignedMedia } from "@/lib/media";

migrateCatalog();

export class SeoFindingError extends HttpError {}

export type SeoFinding = {
  code: "missing-title" | "duplicate-title" | "short-description" |
    "long-title" | "missing-social-image";
  path: string;
  message: string;
  action: string;
  editPath: string;
};

export type SeoPreview = {
  path: string;
  search: { title: string; description: string; canonical: string; indexable: boolean };
  social: { title: string; description: string; image: string | null; url: string };
};

type Candidate = { kind: "article" | "listing"; slug: string; title: string; description: string };
const PAGE_SIZE = 40;

function preview(path: string, title: string, description: string,
  overrides?: SeoOverrides, images?: { published?: string; generated?: string }): SeoPreview {
  const metadata = pageMetadata(path, title, description, overrides, images);
  const graph = metadata.openGraph as {
    title?: string; description?: string; url?: string; images?: string[];
  } | undefined;
  return {
    path,
    search: {
      title: String(metadata.title ?? ""), description: String(metadata.description ?? ""),
      canonical: String(metadata.alternates?.canonical ?? publicUrl(path)),
      indexable: metadata.robots ? (metadata.robots as { index?: boolean }).index !== false : true,
    },
    social: {
      title: String(graph?.title ?? metadata.title ?? ""),
      description: String(graph?.description ?? metadata.description ?? ""),
      image: graph?.images?.[0] ?? null,
      url: String(graph?.url ?? publicUrl(path)),
    },
  };
}

export function seoPreview(kind: "home" | "listing" | "article", slug?: string): SeoPreview {
  if (kind === "home") {
    const site = getSiteConfig();
    return preview("/", site.name, getSeoSettings().description);
  }
  if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new SeoFindingError(404, "Public content not found");
  }
  if (kind === "listing") {
    const listing = publishedListingBySlug(slug);
    if (!listing) throw new SeoFindingError(404, "Public content not found");
    const image = assignedMedia("listing", slug, "public");
    const imported = database.prepare("SELECT 1 FROM agent_imports WHERE slug = ?").get(slug);
    return preview(`/listings/${slug}`, `${listing.name} | ${getSiteConfig().name}`,
      listing.summary, publicSeoOverrides("listing", slug), {
        published: image ? `/media/${image.id}` : undefined,
        generated: imported ? `/og/listings/${slug}.png` : undefined,
      });
  }
  const article = publishedArticleBySlug(slug);
  if (!article) throw new SeoFindingError(404, "Public content not found");
  const image = assignedMedia("article", slug, "public");
  return preview(`/articles/${slug}`, `${article.title} | ${getSiteConfig().name}`,
    article.summary, article.seo, { published: image ? `/media/${image.id}` : undefined });
}

function candidates(page: number): { rows: Candidate[]; page: number; pages: number } {
  const listingCount = (database.prepare(`SELECT COUNT(*) AS count FROM listings l
    WHERE ${PUBLIC_LISTING_PREDICATE}`).get() as { count: number }).count;
  const articleCount = (database.prepare("SELECT COUNT(*) AS count FROM articles WHERE status = 'published'")
    .get() as { count: number }).count;
  const pages = Math.max(1, Math.ceil((listingCount + articleCount) / PAGE_SIZE));
  const selectedPage = Number.isSafeInteger(page) ? Math.min(Math.max(page, 1), pages) : 1;
  const rows = database.prepare(`SELECT 'listing' AS kind, l.slug, l.name AS title,
      l.summary AS description FROM listings l WHERE ${PUBLIC_LISTING_PREDICATE}
    UNION ALL SELECT 'article' AS kind, a.slug, a.title,
      a.summary FROM articles a WHERE a.status = 'published'
    ORDER BY kind, slug LIMIT ? OFFSET ?`)
    .all(PAGE_SIZE, (selectedPage - 1) * PAGE_SIZE) as Candidate[];
  return { rows, page: selectedPage, pages };
}

const duplicateCountSql = `SELECT COUNT(*) AS count FROM (
  SELECT COALESCE(NULLIF(json_extract(seo.public_json, '$.title'), ''), l.name) AS title
    FROM listings l LEFT JOIN seo_overrides seo ON seo.kind = 'listing' AND seo.slug = l.slug
    WHERE ${PUBLIC_LISTING_PREDICATE}
  UNION ALL
  SELECT COALESCE(NULLIF(json_extract(seo.public_json, '$.title'), ''), a.title)
    FROM articles a LEFT JOIN seo_overrides seo ON seo.kind = 'article' AND seo.slug = a.slug
    WHERE a.status = 'published'
) WHERE lower(trim(title)) = lower(trim(?))`;

export function seoFindings(requestedPage = 1): {
  findings: SeoFinding[]; page: number; pages: number; examined: number;
} {
  const { rows, page, pages } = candidates(requestedPage);
  const settings = getSeoSettings();
  const findings: SeoFinding[] = [];
  if (page === 1 && !settings.socialImage && !getSiteConfig().socialImage) {
    findings.push({ code: "missing-social-image", path: "/",
      message: "The site has no default social image.",
      action: "Set a default social image in Search settings.", editPath: "/admin/seo" });
  }
  const duplicateCount = database.prepare(duplicateCountSql);
  for (const row of rows) {
    const path = `/${row.kind === "listing" ? "listings" : "articles"}/${row.slug}`;
    const editPath = row.kind === "listing" ? "/admin/catalog" : "/admin/articles";
    const overrides = publicSeoOverrides(row.kind, row.slug);
    const effective = overrides.title || row.title;
    if (!effective.trim()) {
      findings.push({ code: "missing-title", path, message: "This public page has no search title.",
        action: "Add a clear title to the published content or search override.", editPath });
    } else {
      const count = (duplicateCount.get(effective) as { count: number }).count;
      if (count > 1) findings.push({ code: "duplicate-title", path,
        message: `This search title appears on ${count} public pages.`,
        action: "Give this page a distinct search title.", editPath });
      const formatted = settings.titleFormat.replace("%s", effective);
      if (formatted.length > 70) findings.push({ code: "long-title", path,
        message: "The formatted search title is longer than 70 characters.",
        action: "Shorten the title or site title format.", editPath });
    }
    if ((overrides.description || row.description).trim().length < 50) {
      findings.push({ code: "short-description", path,
        message: "The search description is shorter than 50 characters.",
        action: "Add a specific summary or search description.", editPath });
    }
  }
  return { findings: findings.slice(0, 120), page, pages, examined: rows.length };
}
