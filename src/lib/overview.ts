import { database } from "@/lib/database";
import { migrateCatalog } from "@/lib/catalog-migrations";
import { recentAuditEvents, type AuditEvent } from "@/lib/audit";
import { canAdmin, canEditArticles, canManageBilling, canManageCatalog,
  canManageTaxonomy, canModerate } from "@/lib/admin";
import { PUBLIC_LISTING_PREDICATE } from "@/lib/listings";

migrateCatalog();

export type Overview = {
  publicListings: number;
  publishedArticles: number;
  pendingSubmissions: number;
  recentActivity?: AuditEvent[];
};

export function overviewData(includeAudit: boolean): Overview {
  return database.transaction(() => {
    const publicListings = (database.prepare(`SELECT COUNT(*) AS count FROM listings l
      WHERE ${PUBLIC_LISTING_PREDICATE}`).get() as { count: number }).count;
    const publishedArticles = (database.prepare("SELECT COUNT(*) AS count FROM articles WHERE status = 'published'")
      .get() as { count: number }).count;
    const pendingSubmissions = (database.prepare("SELECT COUNT(*) AS count FROM submissions WHERE status = 'pending'")
      .get() as { count: number }).count;
    return { publicListings, publishedArticles, pendingSubmissions,
      ...(includeAudit ? { recentActivity: recentAuditEvents(5) } : {}) };
  }).deferred();
}

export function overviewDestinations(role: string | null | undefined): { href: string; label: string }[] {
  const destinations: { href: string; label: string }[] = [];
  if (canModerate(role)) destinations.push({ href: "/admin/review", label: "Review submissions" });
  if (canEditArticles(role)) destinations.push({ href: "/admin/articles", label: "Edit articles" });
  if (canManageCatalog(role)) destinations.push({ href: "/admin/catalog", label: "Catalog" });
  if (canManageTaxonomy(role)) destinations.push({ href: "/admin/taxonomy", label: "Categories and tags" });
  if (canManageBilling(role)) destinations.push(
    { href: "/admin/plans", label: "Publishing plans" },
    { href: "/admin/billing", label: "Billing providers" },
  );
  if (canAdmin(role)) destinations.push(
    { href: "/admin/accounts", label: "Accounts and roles" },
    { href: "/admin/seo", label: "Search settings" },
    { href: "/admin/theme", label: "Theme" },
    { href: "/admin/branding", label: "Branding" },
    { href: "/admin/audit", label: "Audit history" },
  );
  return destinations;
}
