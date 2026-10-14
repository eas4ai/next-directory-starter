import { sameOrigin, sessionUser } from "@/lib/admin";
import { moderationErrorResponse, submitOwnerListing } from "@/lib/moderation";

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const user = await sessionUser(request.headers);
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  if (!sameOrigin(request)) return Response.json({ error: "Invalid origin" }, { status: 403 });
  try {
    return Response.json({ submission: submitOwnerListing(user.id, (await params).slug) });
  } catch (error) {
    return moderationErrorResponse(error);
  }
}
