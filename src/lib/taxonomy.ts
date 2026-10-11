import { database } from "@/lib/database";
import { migrateCatalog } from "@/lib/catalog-migrations";
import { HttpError, httpErrorResponse } from "@/lib/http-error";

migrateCatalog();

export type TaxonKind = "category" | "article-category" | "tag";
export type Taxon = { name: string; usageCount: number };
export class TaxonomyError extends HttpError {}
export const taxonomyErrorResponse = httpErrorResponse;

const table = { category: "categories", "article-category": "article_categories", tag: "tags" } as const;

function nameFrom(input: unknown): string {
  if (typeof input !== "string") throw new TaxonomyError(400, "Name is required");
  const name = input.trim();
  if (!name || name.length > 80 || /[\u0000-\u001f/]/u.test(name)) {
    throw new TaxonomyError(400, "Invalid name");
  }
  return name;
}

function storedName(kind: TaxonKind, name: string): string | undefined {
  return (database.prepare(`SELECT name FROM ${table[kind]} WHERE name = ? COLLATE NOCASE`)
    .get(name) as { name: string } | undefined)?.name;
}

export function listTaxa(kind: TaxonKind): Taxon[] {
  if (kind === "category") {
    return database.prepare(`WITH used AS (
        SELECT slug, category FROM listings
        UNION SELECT slug, json_extract(payload, '$.category') FROM owner_drafts
        UNION SELECT slug, json_extract(payload, '$.category') FROM submissions WHERE status = 'pending'
      )
      SELECT c.name, COUNT(used.slug) AS usageCount FROM categories c
      LEFT JOIN used ON used.category = c.name GROUP BY c.name ORDER BY c.name COLLATE NOCASE`)
      .all() as Taxon[];
  }
  if (kind === "article-category") {
    return database.prepare(`WITH used AS (
        SELECT slug, category FROM articles WHERE category IS NOT NULL
        UNION SELECT slug, category FROM article_revisions WHERE category IS NOT NULL
      )
      SELECT c.name, COUNT(used.slug) AS usageCount FROM article_categories c
      LEFT JOIN used ON used.category = c.name GROUP BY c.name ORDER BY c.name COLLATE NOCASE`)
      .all() as Taxon[];
  }
  return database.prepare(`SELECT t.name, COUNT(a.article_slug) AS usageCount FROM tags t
    LEFT JOIN article_tags a ON a.tag_name = t.name GROUP BY t.name ORDER BY t.name COLLATE NOCASE`)
    .all() as Taxon[];
}

export function createTaxon(kind: TaxonKind, input: unknown): string {
  const name = nameFrom(input);
  database.transaction(() => {
    if (storedName(kind, name)) throw new TaxonomyError(409, "Name already exists");
    database.prepare(`INSERT INTO ${table[kind]} (name) VALUES (?)`).run(name);
  }).immediate();
  return name;
}

export function renameTaxon(kind: TaxonKind, original: string, input: unknown): string {
  const next = nameFrom(input);
  database.transaction(() => {
    const prior = storedName(kind, original);
    if (!prior) throw new TaxonomyError(404, "Name not found");
    if (prior === next) return;
    if (storedName(kind, next)) throw new TaxonomyError(409, "Name already exists");
    database.prepare(`INSERT INTO ${table[kind]} (name) VALUES (?)`).run(next);
    if (kind === "category") {
      database.prepare(`UPDATE listings SET category = ?, revision = revision + 1
        WHERE category = ?`).run(next, prior);
      database.prepare(`UPDATE owner_drafts SET payload = json_set(payload, '$.category', ?)
        WHERE json_extract(payload, '$.category') = ?`).run(next, prior);
      database.prepare(`UPDATE submissions SET payload = json_set(payload, '$.category', ?)
        WHERE status = 'pending' AND json_extract(payload, '$.category') = ?`).run(next, prior);
    } else if (kind === "article-category") {
      database.prepare("UPDATE articles SET category = ? WHERE category = ?").run(next, prior);
      database.prepare("UPDATE article_revisions SET category = ? WHERE category = ?").run(next, prior);
    } else {
      database.prepare("UPDATE article_tags SET tag_name = ? WHERE tag_name = ?").run(next, prior);
    }
    database.prepare(`DELETE FROM ${table[kind]} WHERE name = ?`).run(prior);
  }).immediate();
  return next;
}

export function deleteTaxon(kind: TaxonKind, original: string): void {
  database.transaction(() => {
    const name = storedName(kind, original);
    if (!name) throw new TaxonomyError(404, "Name not found");
    const used = kind === "category"
      ? (database.prepare(`SELECT
          EXISTS(SELECT 1 FROM listings WHERE category = ?) OR
          EXISTS(SELECT 1 FROM owner_drafts WHERE json_extract(payload, '$.category') = ?) OR
          EXISTS(SELECT 1 FROM submissions WHERE status = 'pending'
            AND json_extract(payload, '$.category') = ?) AS used`)
          .get(name, name, name) as { used: number }).used
      : kind === "article-category"
        ? (database.prepare(`SELECT EXISTS(SELECT 1 FROM articles WHERE category = ?) OR
          EXISTS(SELECT 1 FROM article_revisions WHERE category = ?) AS used`)
          .get(name, name) as { used: number }).used
        : Boolean(database.prepare("SELECT 1 FROM article_tags WHERE tag_name = ? LIMIT 1").get(name));
    if (used) {
      throw new TaxonomyError(409, "Remove this name from content before deleting it");
    }
    database.prepare(`DELETE FROM ${table[kind]} WHERE name = ?`).run(name);
  }).immediate();
}
