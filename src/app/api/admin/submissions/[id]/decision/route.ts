import { canModerate, sameOrigin, sessionUser } from "@/lib/admin";
import { decideSubmission, moderationErrorResponse } from "@/lib/moderation";
import { requestJson } from "@/lib/request-json";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await sessionUser(request.headers);
  if (!user || !canModerate(user.role)) return Response.json({ error: "Forbidden" }, { status: 403 });
  if (!sameOrigin(request)) return Response.json({ error: "Invalid origin" }, { status: 403 });
  let input: unknown;
  try { input = await requestJson(request); }
  catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return Response.json({ error: "Invalid decision" }, { status: 400 });
  }
  const { decision, reason } = input as Record<string, unknown>;
  if ((decision !== "approve" && decision !== "reject") ||
      typeof reason !== "string" || reason.length > 500 ||
      (decision === "reject" && !reason.trim())) {
    return Response.json({ error: "Invalid decision or reason" }, { status: 400 });
  }
  try {
    decideSubmission((await params).id, user.id, decision, reason.trim());
    return Response.json({ ok: true });
  } catch (error) {
    return moderationErrorResponse(error);
  }
}
