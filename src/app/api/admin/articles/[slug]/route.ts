import { canEditArticles, sameOrigin, sessionUser } from "@/lib/admin";
import { articleBySlug, articleErrorResponse, editableArticleBySlug,
  publishArticleRevision, saveArticleRevision, updateArticle } from "@/lib/articles";
import { requestJson, requestJsonErrorResponse } from "@/lib/request-json";

const MAX_ARTICLE_JSON_LENGTH = 512_000;

type Params = { params: Promise<{ slug: string }> };

export async function GET(request: Request, { params }: Params) {
  const user = await sessionUser(request.headers);
  if (!canEditArticles(user?.role)) return Response.json({ error: "Forbidden" }, { status: 403 });
  const article = editableArticleBySlug((await params).slug);
  return article
    ? Response.json({ article })
    : Response.json({ error: "Article not found" }, { status: 404 });
}

export async function PATCH(request: Request, { params }: Params) {
  const user = await sessionUser(request.headers);
  if (!user || !canEditArticles(user.role)) return Response.json({ error: "Forbidden" }, { status: 403 });
  if (!sameOrigin(request)) return Response.json({ error: "Invalid origin" }, { status: 403 });
  let input: unknown;
  try { input = await requestJson(request, MAX_ARTICLE_JSON_LENGTH); }
  catch (error) { return requestJsonErrorResponse(error); }
  try {
    const slug = (await params).slug;
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      return Response.json({ error: "Invalid article changes" }, { status: 400 });
    }
    const changes = input as Record<string, unknown>;
    if (changes.action === "publish") {
      return Response.json({ article: publishArticleRevision(slug, changes.version as number, user.id) });
    }
    if (changes.action === "save" || Object.keys(changes).some((key) =>
      ["title", "summary", "body", "tags"].includes(key))) {
      return Response.json({ article: saveArticleRevision(slug, changes, changes.version as number, user.id) });
    }
    if (Object.keys(changes).length === 1 &&
        (changes.status === "draft" || changes.status === "published")) {
      const current = articleBySlug(slug);
      if (!current) return Response.json({ error: "Article not found" }, { status: 404 });
      if (changes.status === "published" && current.status === "published") {
        return Response.json({ error: "No saved revision to publish" }, { status: 409 });
      }
      return Response.json({ article: updateArticle(slug, changes, user.id) });
    }
    return Response.json({ error: "Invalid article action" }, { status: 400 });
  } catch (error) {
    return articleErrorResponse(error);
  }
}
