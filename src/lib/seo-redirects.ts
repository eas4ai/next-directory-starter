import { database } from "@/lib/database";
import { migrateCatalog } from "@/lib/catalog-migrations";
import { recordAudit } from "@/lib/audit";
import { HttpError, httpErrorResponse } from "@/lib/http-error";
import { randomUUID } from "node:crypto";

migrateCatalog();

export class RedirectError extends HttpError {}
export const redirectErrorResponse = httpErrorResponse;

export type SiteRedirect = {
  source: string;
  destination: string;
  createdAt: string;
  updatedAt: string;
};

type RedirectRow = { source_path: string; destination_path: string;
  created_at: string; updated_at: string };

function path(value: unknown, allowRoot: boolean): string {
  if (typeof value !== "string" || value.length > 180 ||
      !/^\/(?:[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*)?$/.test(value) ||
      (!allowRoot && value === "/")) {
    throw new RedirectError(400, "Use a bounded path without a host, query, or fragment");
  }
  return value;
}

function protectedRoute(source: string): boolean {
  return ["/", "/listings", "/articles", "/feed", "/robots", "/sitemap", "/favicon", "/admin",
    "/owner", "/api", "/markdown", "/media", "/_next"].some((prefix) =>
      source === prefix || source.startsWith(`${prefix}/`));
}

function liveContentRoute(source: string): boolean {
  const article = /^\/articles\/([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(source);
  if (article) return Boolean(database.prepare("SELECT 1 FROM articles WHERE slug = ?").get(article[1]));
  const listing = /^\/listings\/([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(source);
  if (listing) return Boolean(database.prepare("SELECT 1 FROM listings WHERE slug = ?").get(listing[1]));
  return false;
}

function unavailableSource(source: string): boolean {
  if (/^\/(?:articles|listings)\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(source)) {
    return liveContentRoute(source);
  }
  return protectedRoute(source) || liveContentRoute(source);
}

export function redirectForPath(source: string): string | null {
  const row = database.prepare("SELECT destination_path FROM seo_redirects WHERE source_path = ?")
    .get(source) as { destination_path: string } | undefined;
  return row?.destination_path ?? null;
}

export function listRedirects(): SiteRedirect[] {
  const rows = database.prepare(`SELECT * FROM seo_redirects ORDER BY updated_at DESC, source_path LIMIT 50`)
    .all() as RedirectRow[];
  return rows.map((row) => ({ source: row.source_path, destination: row.destination_path,
    createdAt: row.created_at, updatedAt: row.updated_at }));
}

export function saveRedirect(sourceInput: unknown, destinationInput: unknown, actorId: string): SiteRedirect {
  const source = path(sourceInput, false);
  const destination = path(destinationInput, true);
  if (source === destination || unavailableSource(source)) {
    throw new RedirectError(409, "Redirect would shadow a live route or point to itself");
  }
  return database.transaction(() => {
    const count = (database.prepare("SELECT COUNT(*) AS count FROM seo_redirects").get() as { count: number }).count;
    const existing = database.prepare("SELECT * FROM seo_redirects WHERE source_path = ?")
      .get(source) as RedirectRow | undefined;
    if (!existing && count >= 500) throw new RedirectError(409, "Redirect limit reached");
    const seen = new Set([source]);
    let next: string | null = destination;
    for (let step = 0; next && step <= 500; step += 1) {
      if (seen.has(next)) throw new RedirectError(409, "Redirect cycle");
      seen.add(next);
      next = redirectForPath(next);
    }
    if (next) throw new RedirectError(409, "Redirect chain is too long");
    const now = new Date().toISOString();
    database.prepare(`INSERT INTO seo_redirects
      (source_path, destination_path, created_at, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(source_path) DO UPDATE SET destination_path = excluded.destination_path,
        updated_at = excluded.updated_at`).run(source, destination, now, now);
    recordAudit("seo.redirect", actorId, source);
    return { source, destination, createdAt: existing?.created_at ?? now, updatedAt: now };
  }).immediate();
}

export function deleteRedirect(sourceInput: unknown, actorId: string): void {
  const source = path(sourceInput, false);
  database.transaction(() => {
    const result = database.prepare("DELETE FROM seo_redirects WHERE source_path = ?").run(source);
    if (result.changes !== 1) throw new RedirectError(404, "Redirect not found");
    recordAudit("seo.redirect.delete", actorId, source);
  }).immediate();
}

export function recordNotFound(requestPath: string, requestId: string = randomUUID()): void {
  if (requestPath.length > 180 || !/^\/(?:[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*)?$/.test(requestPath) ||
      requestPath === "/" || /^\/(?:api|admin|owner|_next)(?:\/|$)/.test(requestPath)) return;
  const now = new Date().toISOString();
  database.transaction(() => {
    database.prepare(`INSERT INTO seo_not_found (path, hits, first_seen_at, last_seen_at, last_request_id)
      VALUES (?, 1, ?, ?, ?) ON CONFLICT(path) DO UPDATE SET
      hits = CASE WHEN last_request_id = excluded.last_request_id THEN hits
        ELSE MIN(hits + 1, 1000000) END,
      last_seen_at = excluded.last_seen_at, last_request_id = excluded.last_request_id`)
      .run(requestPath, now, now, requestId);
    const count = (database.prepare("SELECT COUNT(*) AS count FROM seo_not_found").get() as { count: number }).count;
    if (count > 500) {
      database.prepare(`DELETE FROM seo_not_found WHERE path IN
        (SELECT path FROM seo_not_found ORDER BY last_seen_at ASC, path ASC LIMIT ?)`)
        .run(count - 500);
    }
  }).immediate();
}

export function listNotFound(): {
  path: string; hits: number; firstSeenAt: string; lastSeenAt: string;
}[] {
  const rows = database.prepare(`SELECT path, hits, first_seen_at, last_seen_at
    FROM seo_not_found ORDER BY last_seen_at DESC, path LIMIT 50`).all() as {
    path: string; hits: number; first_seen_at: string; last_seen_at: string;
  }[];
  return rows.map((row) => ({ path: row.path, hits: row.hits,
    firstSeenAt: row.first_seen_at, lastSeenAt: row.last_seen_at }));
}
