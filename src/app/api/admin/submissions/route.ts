import { canModerate, sessionUser } from "@/lib/admin";
import { reviewSubmissions } from "@/lib/moderation";

export async function GET(request: Request) {
  const user = await sessionUser(request.headers);
  if (!canModerate(user?.role)) return Response.json({ error: "Forbidden" }, { status: 403 });
  const page = Number(new URL(request.url).searchParams.get("page") ?? "1");
  return Response.json(reviewSubmissions(page));
}
