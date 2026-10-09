import { canEditArticles, sameOrigin, sessionUser } from "@/lib/admin";
import { articleErrorResponse, createArticle, listArticles } from "@/lib/articles";
import { requestJson } from "@/lib/request-json";

export async function GET(request: Request) {
  const user = await sessionUser(request.headers);
  if (!canEditArticles(user?.role)) return Response.json({ error: "Forbidden" }, { status: 403 });
  const page = Number(new URL(request.url).searchParams.get("page") ?? "1");
  return Response.json(listArticles(page));
}

export async function POST(request: Request) {
  const user = await sessionUser(request.headers);
  if (!user || !canEditArticles(user.role)) return Response.json({ error: "Forbidden" }, { status: 403 });
  if (!sameOrigin(request)) return Response.json({ error: "Invalid origin" }, { status: 403 });
  let input: unknown;
  try { input = await requestJson(request); }
  catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  try {
    return Response.json({ article: createArticle(input, user.id) }, { status: 201 });
  } catch (error) {
    return articleErrorResponse(error);
  }
}
