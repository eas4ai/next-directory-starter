import { isAdmin } from "@/lib/admin";
import { httpErrorResponse } from "@/lib/http-error";
import { seoFindings, seoPreview } from "@/lib/seo-findings";

export async function GET(request: Request) {
  if (!(await isAdmin(request.headers))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const query = new URL(request.url).searchParams;
  const kind = query.get("kind") ?? "home";
  if (kind !== "home" && kind !== "listing" && kind !== "article") {
    return Response.json({ error: "Invalid preview kind" }, { status: 400 });
  }
  const page = Number(query.get("page") ?? "1");
  try {
    return Response.json({ ...seoFindings(page), preview: seoPreview(kind, query.get("slug") ?? undefined) });
  } catch (error) { return httpErrorResponse(error); }
}
