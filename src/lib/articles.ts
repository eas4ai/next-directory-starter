import { database } from "@/lib/database";
import { migrateCatalog } from "@/lib/catalog-migrations";
import { HttpError, httpErrorResponse } from "@/lib/http-error";

migrateCatalog();

export type ArticleStatus = "draft" | "published";

export type Article = {
  slug: string;
  title: string;
  summary: string;
  body: string;
  status: ArticleStatus;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
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
};

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
    tags,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at,
  };
}

function validate(value: unknown): Pick<Article, "slug" | "title" | "summary" | "body" | "status" | "tags"> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ArticleError(400, "Invalid article");
  }
  const input = value as Record<string, unknown>;
  const { slug, title, summary, body, status, tags } = input;
  if (typeof slug !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 80 ||
      typeof title !== "string" || !title.trim() || title.length > 160 ||
      typeof summary !== "string" || !summary.trim() || summary.length > 320 ||
      typeof body !== "string" || !body.trim() || body.length > 50_000 ||
      (status !== "draft" && status !== "published") ||
      !Array.isArray(tags) || tags.length > 12 ||
      tags.some((tag) => typeof tag !== "string" || !tag.trim() || tag.length > 80) ||
      new Set(tags.map((tag) => String(tag).toLowerCase())).size !== tags.length) {
    throw new ArticleError(400, "Invalid article fields");
  }
  return { slug, title: title.trim(), summary: summary.trim(), body: body.trim(), status, tags: tags as string[] };
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

export function createArticle(input: unknown, actorId: string): Article {
  const article = validate(input);
  const now = new Date().toISOString();
  try {
    database.transaction(() => {
      database.prepare(`INSERT INTO articles
        (slug, title, summary, body, status, author_user_id, created_at, updated_at, published_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        article.slug, article.title, article.summary, article.body, article.status,
        actorId, now, now, article.status === "published" ? now : null,
      );
      setTags(article.slug, article.tags);
    }).immediate();
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE constraint")) {
      throw new ArticleError(409, "Article slug already exists");
    }
    throw error;
  }
  return articleBySlug(article.slug)!;
}

export function updateArticle(slug: string, changes: unknown): Article {
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) {
    throw new ArticleError(400, "Invalid article changes");
  }
  return database.transaction(() => {
    const current = articleBySlug(slug);
    if (!current) throw new ArticleError(404, "Article not found");
    const article = validate({ ...current, ...changes, slug });
    const now = new Date().toISOString();
    const publishedAt = article.status === "published"
      ? current.publishedAt ?? now : null;
    database.prepare(`UPDATE articles SET title = ?, summary = ?, body = ?, status = ?,
      updated_at = ?, published_at = ? WHERE slug = ?`).run(
      article.title, article.summary, article.body, article.status, now, publishedAt, slug,
    );
    setTags(slug, article.tags);
    return articleBySlug(slug)!;
  }).immediate();
}
