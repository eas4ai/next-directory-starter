import { canEditArticles, sameOrigin, sessionUser } from "@/lib/admin";
import { articleBySlug, articleErrorResponse, updateArticle } from "@/lib/articles";
import { requestJson } from "@/lib/request-json";

type Params = { params: Promise<{ slug: string }> };

export async function GET(request: Request, { params }: Params) {
  const user = await sessionUser(request.headers);
  if (!canEditArticles(user?.role)) return Response.json({ error: "Forbidden" }, { status: 403 });
  const article = articleBySlug((await params).slug);
  return article
    ? Response.json({ article })
    : Response.json({ error: "Article not found" }, { status: 404 });
}

export async function PATCH(request: Request, { params }: Params) {
  const user = await sessionUser(request.headers);
  if (!user || !canEditArticles(user.role)) return Response.json({ error: "Forbidden" }, { status: 403 });
  if (!sameOrigin(request)) return Response.json({ error: "Invalid origin" }, { status: 403 });
  let input: unknown;
  try { input = await requestJson(request); }
  catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  try {
    return Response.json({ article: updateArticle((await params).slug, input) });
  } catch (error) {
    return articleErrorResponse(error);
  }
}
