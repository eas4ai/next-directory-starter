import { sameOrigin, sessionUser } from "@/lib/admin";
import { moderationErrorResponse, ownerListing, updateOwnerListing } from "@/lib/moderation";
import { requestJson } from "@/lib/request-json";

type Params = { params: Promise<{ slug: string }> };

export async function GET(request: Request, { params }: Params) {
  const user = await sessionUser(request.headers);
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  try {
    return Response.json(ownerListing(user.id, (await params).slug));
  } catch (error) {
    return moderationErrorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: Params) {
  const user = await sessionUser(request.headers);
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  if (!sameOrigin(request)) return Response.json({ error: "Invalid origin" }, { status: 403 });
  let input: unknown;
  try { input = await requestJson(request); }
  catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  try {
    return Response.json({ listing: updateOwnerListing(user.id, (await params).slug, input) });
  } catch (error) {
    return moderationErrorResponse(error);
  }
}
