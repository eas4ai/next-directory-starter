import { canModerate, sameOrigin, sessionUser } from "@/lib/admin";
import { moderationErrorResponse, suspendPublishedListing } from "@/lib/moderation";
import { requestJson } from "@/lib/request-json";

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const user = await sessionUser(request.headers);
  if (!user || !canModerate(user.role)) return Response.json({ error: "Forbidden" }, { status: 403 });
  if (!sameOrigin(request)) return Response.json({ error: "Invalid origin" }, { status: 403 });
  let input: unknown;
  try { input = await requestJson(request); }
  catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  const reason = input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>).reason : undefined;
  if (typeof reason !== "string" || !reason.trim() || reason.length > 500) {
    return Response.json({ error: "Suspension reason is required" }, { status: 400 });
  }
  try {
    suspendPublishedListing((await params).slug, user.id, reason.trim());
    return Response.json({ ok: true });
  } catch (error) {
    return moderationErrorResponse(error);
  }
}
