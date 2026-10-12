import { database } from "@/lib/database";
import { migrateCatalog } from "@/lib/catalog-migrations";
import { HttpError, httpErrorResponse } from "@/lib/http-error";
import { recordAudit } from "@/lib/audit";
import { promoteDraftMedia } from "@/lib/media";
import { editableSeoOverrides, publicSeoOverrides, publishDraftSeo, saveDraftSeo,
  type SeoOverrides } from "@/lib/seo-settings";
import { redirectForPath, saveRedirect } from "@/lib/seo-redirects";

migrateCatalog();

export type ArticleStatus = "draft" | "published";

export type Article = {
  slug: string;
  title: string;
  summary: string;
  body: string;
  status: ArticleStatus;
  category: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  version: number;
  staged: boolean;
  seo: SeoOverrides;
};

type ArticleRow = {
  slug: string;
  title: string;
  summary: string;
  body: string;
  status: ArticleStatus;
  created_at: string;
  updated_at: string;
  published_at: string | null;
  revision: number;
  category: string | null;
};

export type ArticleFeedRow = Pick<ArticleRow, "slug" | "title" | "summary" | "published_at">;

export class ArticleError extends HttpError {}
export const articleErrorResponse = httpErrorResponse;

function tagsByArticle(slugs: string[]): Map<string, string[]> {
  const result = new Map<string, string[]>();
  if (slugs.length === 0) return result;
  const placeholders = slugs.map(() => "?").join(", ");
  const rows = database.prepare(`SELECT article_slug, tag_name FROM article_tags
    WHERE article_slug IN (${placeholders}) ORDER BY tag_name COLLATE NOCASE`)
    .all(...slugs) as { article_slug: string; tag_name: string }[];
  for (const row of rows) {
    const names = result.get(row.article_slug) ?? [];
    names.push(row.tag_name);
    result.set(row.article_slug, names);
  }
  return result;
}

function fromRow(row: ArticleRow, tags: string[]): Article {
  return {
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    body: row.body,
    status: row.status,
    category: row.category,
    tags,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at,
    version: row.revision,
    staged: false,
    seo: publicSeoOverrides("article", row.slug),
  };
}

function validate(value: unknown): Pick<Article, "slug" | "title" | "summary" | "body" | "status" | "category" | "tags"> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ArticleError(400, "Invalid article");
  }
  const input = value as Record<string, unknown>;
  const { slug, title, summary, body, status, tags } = input;
  const category = input.category === undefined || input.category === "" ? null : input.category;
  if (typeof slug !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 80 ||
      typeof title !== "string" || !title.trim() || title.length > 160 ||
      typeof summary !== "string" || !summary.trim() || summary.length > 320 ||
      typeof body !== "string" || !body.trim() || body.length > 50_000 ||
      (status !== "draft" && status !== "published") ||
      (category !== null && (typeof category !== "string" || category.length > 80)) ||
      !Array.isArray(tags) || tags.length > 12 ||
      tags.some((tag) => typeof tag !== "string" || !tag.trim() || tag.length > 80) ||
      new Set(tags.map((tag) => String(tag).toLowerCase())).size !== tags.length) {
    throw new ArticleError(400, "Invalid article fields");
  }
  return { slug, title: title.trim(), summary: summary.trim(), body: body.trim(), status,
    category: category as string | null, tags: tags as string[] };
}

function canonicalCategory(category: string | null): string | null {
  if (category === null) return null;
  const row = database.prepare("SELECT name FROM article_categories WHERE name = ? COLLATE NOCASE")
    .get(category) as { name: string } | undefined;
  if (!row) throw new ArticleError(400, `Unknown article category: ${category}`);
  return row.name;
}

function setTags(slug: string, tags: string[]): void {
  const exists = database.prepare("SELECT name FROM tags WHERE name = ? COLLATE NOCASE");
  const insert = database.prepare("INSERT INTO article_tags (article_slug, tag_name) VALUES (?, ?)");
  database.prepare("DELETE FROM article_tags WHERE article_slug = ?").run(slug);
  for (const tag of tags) {
    const row = exists.get(tag) as { name: string } | undefined;
    if (!row) throw new ArticleError(400, `Unknown tag: ${tag}`);
    insert.run(slug, row.name);
  }
}

export function articleBySlug(slug: string): Article | undefined {
  const row = database.prepare("SELECT * FROM articles WHERE slug = ?").get(slug) as ArticleRow | undefined;
  return row ? fromRow(row, tagsByArticle([slug]).get(slug) ?? []) : undefined;
}

export function editableArticleBySlug(slug: string): Article | undefined {
  const current = articleBySlug(slug);
  if (!current) return current;
  const seo = editableSeoOverrides("article", slug);
  if (current.status !== "published") return { ...current, seo };
  const staged = database.prepare(`SELECT title, summary, body, tags_json, category FROM article_revisions
    WHERE slug = ?`).get(slug) as {
    title: string; summary: string; body: string; tags_json: string; category: string | null;
  } | undefined;
  if (!staged) return { ...current, seo };
  return { ...current, title: staged.title, summary: staged.summary, body: staged.body,
    category: staged.category,
    tags: JSON.parse(staged.tags_json) as string[], staged: true, seo };
}

export function publishedArticleBySlug(slug: string): Article | undefined {
  const article = articleBySlug(slug);
  return article?.status === "published" ? article : undefined;
}

export function listArticles(page = 1, publishedOnly = false): { articles: Article[]; page: number; pages: number } {
  const filter = publishedOnly ? "WHERE status = 'published'" : "";
  const total = (database.prepare(`SELECT COUNT(*) AS count FROM articles ${filter}`).get() as { count: number }).count;
  const pages = Math.max(1, Math.ceil(total / 20));
  const selectedPage = Math.min(Math.max(1, Number.isFinite(page) ? Math.floor(page) : 1), pages);
  const rows = database.prepare(`SELECT * FROM articles ${filter}
    ORDER BY CASE WHEN status = 'published' THEN 0 ELSE 1 END,
      updated_at DESC, slug LIMIT 20 OFFSET ?`)
    .all((selectedPage - 1) * 20) as ArticleRow[];
  const tagMap = tagsByArticle(rows.map((row) => row.slug));
  return { articles: rows.map((row) => fromRow(row, tagMap.get(row.slug) ?? [])), page: selectedPage, pages };
}

export type ArticleSearch = { query?: string; category?: string; tag?: string; page?: number };

export function searchPublishedArticles(filters: ArticleSearch): {
  articles: Article[]; page: number; pages: number; total: number;
} {
  const query = (filters.query ?? "").trim().slice(0, 120);
  const category = (filters.category ?? "").trim().slice(0, 80);
  const tag = (filters.tag ?? "").trim().slice(0, 80);
  const where = ["a.status = 'published'"];
  const values: string[] = [];
  if (query) {
    where.push("(instr(lower(a.title), lower(?)) > 0 OR instr(lower(a.summary), lower(?)) > 0 OR instr(lower(a.body), lower(?)) > 0)");
    values.push(query, query, query);
  }
  if (category) {
    where.push("a.category = ? COLLATE NOCASE");
    values.push(category);
  }
  if (tag) {
    where.push(`EXISTS (SELECT 1 FROM article_tags at
      WHERE at.article_slug = a.slug AND at.tag_name = ? COLLATE NOCASE)`);
    values.push(tag);
  }
  const from = `FROM articles a WHERE ${where.join(" AND ")}`;
  const total = (database.prepare(`SELECT COUNT(*) AS count ${from}`).get(...values) as { count: number }).count;
  const pages = Math.max(1, Math.ceil(total / 20));
  const page = Number.isFinite(filters.page) ? Math.min(pages, Math.max(1, Math.floor(filters.page!))) : 1;
  const rows = database.prepare(`SELECT a.* ${from}
    ORDER BY a.published_at DESC, a.slug LIMIT 20 OFFSET ?`)
    .all(...values, (page - 1) * 20) as ArticleRow[];
  const tagMap = tagsByArticle(rows.map((row) => row.slug));
  return { articles: rows.map((row) => fromRow(row, tagMap.get(row.slug) ?? [])), page, pages, total };
}

export function publishedArticleTerms(): { categories: string[]; tags: string[] } {
  const categories = database.prepare(`SELECT DISTINCT category AS name FROM articles
    WHERE status = 'published' AND category IS NOT NULL ORDER BY category COLLATE NOCASE`)
    .all() as { name: string }[];
  const tags = database.prepare(`SELECT DISTINCT at.tag_name AS name FROM article_tags at
    JOIN articles a ON a.slug = at.article_slug WHERE a.status = 'published'
    ORDER BY at.tag_name COLLATE NOCASE`).all() as { name: string }[];
  return { categories: categories.map((row) => row.name), tags: tags.map((row) => row.name) };
}

export function publishedArticleFeedRows(): ArticleFeedRow[] {
  return database.prepare(`SELECT slug, title, summary, published_at FROM articles
    WHERE status = 'published' ORDER BY published_at DESC, slug`)
    .all() as ArticleFeedRow[];
}

export function createArticle(input: unknown, actorId: string): Article {
  const article = validate(input);
  const category = canonicalCategory(article.category);
  const now = new Date().toISOString();
  try {
    database.transaction(() => {
      if (redirectForPath(`/articles/${article.slug}`)) {
        throw new ArticleError(409, "Article slug is reserved by a redirect");
      }
      database.prepare(`INSERT INTO articles
        (slug, title, summary, body, status, author_user_id, created_at, updated_at, published_at, category)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        article.slug, article.title, article.summary, article.body, article.status,
        actorId, now, now, article.status === "published" ? now : null, category,
      );
      setTags(article.slug, article.tags);
      if (input && typeof input === "object" && "seo" in input) {
        saveDraftSeo("article", article.slug, (input as { seo: unknown }).seo);
        if (article.status === "published") publishDraftSeo("article", article.slug);
      }
      recordAudit(article.status === "published" ? "article.publish" : "article.create", actorId, article.slug);
    }).immediate();
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE constraint")) {
      throw new ArticleError(409, "Article slug already exists");
    }
    throw error;
  }
  return articleBySlug(article.slug)!;
}

export function saveArticleRevision(slug: string, changes: unknown,
  expectedVersion: number, actorId: string): Article {
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) {
    throw new ArticleError(400, "Invalid article changes");
  }
  return database.transaction(() => {
    const current = editableArticleBySlug(slug);
    if (!current) throw new ArticleError(404, "Article not found");
    if (!Number.isSafeInteger(expectedVersion) || current.version !== expectedVersion) {
      throw new ArticleError(409, "Article changed since it was opened; refresh before saving");
    }
    const article = validate({ ...current, ...changes, slug, status: current.status });
    const category = canonicalCategory(article.category);
    const canonicalTags = article.tags.map((tag) => {
      const row = database.prepare("SELECT name FROM tags WHERE name = ? COLLATE NOCASE")
        .get(tag) as { name: string } | undefined;
      if (!row) throw new ArticleError(400, `Unknown tag: ${tag}`);
      return row.name;
    });
    const now = new Date().toISOString();
    if (current.status === "published") {
      database.prepare(`INSERT INTO article_revisions
        (slug, title, summary, body, tags_json, saved_at, category) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(slug) DO UPDATE SET title = excluded.title, summary = excluded.summary,
          body = excluded.body, tags_json = excluded.tags_json, saved_at = excluded.saved_at,
          category = excluded.category`)
        .run(slug, article.title, article.summary, article.body, JSON.stringify(canonicalTags), now, category);
    } else {
      database.prepare(`UPDATE articles SET title = ?, summary = ?, body = ?, category = ?, updated_at = ?
        WHERE slug = ?`).run(article.title, article.summary, article.body, category, now, slug);
      setTags(slug, canonicalTags);
    }
    if ("seo" in changes) saveDraftSeo("article", slug, changes.seo);
    database.prepare("UPDATE articles SET revision = revision + 1 WHERE slug = ?").run(slug);
    recordAudit("article.save", actorId, slug);
    return editableArticleBySlug(slug)!;
  }).immediate();
}

export function publishArticleRevision(slug: string, expectedVersion: number,
  actorId: string): Article {
  return database.transaction(() => {
    const current = articleBySlug(slug);
    if (!current) throw new ArticleError(404, "Article not found");
    if (!Number.isSafeInteger(expectedVersion) || current.version !== expectedVersion) {
      throw new ArticleError(409, "Article changed since it was opened; refresh before publishing");
    }
    const staged = database.prepare(`SELECT title, summary, body, tags_json, category FROM article_revisions
      WHERE slug = ?`).get(slug) as {
      title: string; summary: string; body: string; tags_json: string; category: string | null;
    } | undefined;
    if (current.status === "published" && !staged) {
      throw new ArticleError(409, "No saved revision to publish");
    }
    const now = new Date().toISOString();
    if (staged) {
      database.prepare(`UPDATE articles SET title = ?, summary = ?, body = ?, category = ?,
        status = 'published', updated_at = ?, published_at = COALESCE(published_at, ?),
        revision = revision + 1 WHERE slug = ?`)
        .run(staged.title, staged.summary, staged.body, staged.category, now, now, slug);
      setTags(slug, JSON.parse(staged.tags_json) as string[]);
      database.prepare("DELETE FROM article_revisions WHERE slug = ?").run(slug);
    } else {
      database.prepare(`UPDATE articles SET status = 'published', updated_at = ?,
        published_at = ?, revision = revision + 1 WHERE slug = ?`).run(now, now, slug);
    }
    promoteDraftMedia("article", slug);
    publishDraftSeo("article", slug);
    recordAudit("article.publish", actorId, slug);
    return articleBySlug(slug)!;
  }).immediate();
}

export function updateArticle(slug: string, changes: unknown, actorId: string): Article {
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) {
    throw new ArticleError(400, "Invalid article changes");
  }
  return database.transaction(() => {
    const current = articleBySlug(slug);
    if (!current) throw new ArticleError(404, "Article not found");
    const article = validate({ ...current, ...changes, slug });
    const category = canonicalCategory(article.category);
    const now = new Date().toISOString();
    const publishedAt = article.status === "published"
      ? current.publishedAt ?? now : null;
    database.prepare(`UPDATE articles SET title = ?, summary = ?, body = ?, status = ?, category = ?,
      updated_at = ?, published_at = ?, revision = revision + 1 WHERE slug = ?`).run(
      article.title, article.summary, article.body, article.status, category, now, publishedAt, slug,
    );
    if (article.status === "draft") database.prepare("DELETE FROM article_revisions WHERE slug = ?").run(slug);
    if (article.status === "published" && current.status !== "published") {
      promoteDraftMedia("article", slug);
      publishDraftSeo("article", slug);
    }
    setTags(slug, article.tags);
    recordAudit(article.status === "published" ? "article.publish" :
      current.status === "published" ? "article.unpublish" : "article.update", actorId, slug);
    return articleBySlug(slug)!;
  }).immediate();
}

export function renameArticle(slug: string, newSlug: unknown, expectedVersion: number,
  actorId: string): Article {
  if (typeof newSlug !== "string" || newSlug.length > 80 ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(newSlug) || newSlug === slug) {
    throw new ArticleError(400, "Invalid new article slug");
  }
  return database.transaction(() => {
    const current = articleBySlug(slug);
    if (!current) throw new ArticleError(404, "Article not found");
    if (!Number.isSafeInteger(expectedVersion) || current.version !== expectedVersion) {
      throw new ArticleError(409, "Article changed since it was opened; refresh before renaming");
    }
    if (articleBySlug(newSlug) || redirectForPath(`/articles/${newSlug}`)) {
      throw new ArticleError(409, "New article slug is already in use");
    }
    const now = new Date().toISOString();
    database.prepare(`INSERT INTO articles
      (slug, title, summary, body, status, author_user_id, created_at, updated_at,
        published_at, revision, category)
      SELECT ?, title, summary, body, status, author_user_id, created_at, ?,
        published_at, revision + 1, category FROM articles WHERE slug = ?`)
      .run(newSlug, now, slug);
    database.prepare(`INSERT INTO article_tags (article_slug, tag_name)
      SELECT ?, tag_name FROM article_tags WHERE article_slug = ?`).run(newSlug, slug);
    database.prepare(`INSERT INTO article_revisions
      (slug, title, summary, body, tags_json, saved_at, category)
      SELECT ?, title, summary, body, tags_json, saved_at, category
      FROM article_revisions WHERE slug = ?`).run(newSlug, slug);
    database.prepare("UPDATE media_assets SET target_slug = ? WHERE target_kind = 'article' AND target_slug = ?")
      .run(newSlug, slug);
    database.prepare("UPDATE media_assignments SET target_slug = ? WHERE target_kind = 'article' AND target_slug = ?")
      .run(newSlug, slug);
    database.prepare("UPDATE seo_overrides SET slug = ? WHERE kind = 'article' AND slug = ?")
      .run(newSlug, slug);
    database.prepare("DELETE FROM articles WHERE slug = ?").run(slug);
    if (current.status === "published") saveRedirect(`/articles/${slug}`, `/articles/${newSlug}`, actorId);
    recordAudit("article.rename", actorId, `${slug} -> ${newSlug}`);
    return editableArticleBySlug(newSlug)!;
  }).immediate();
}
