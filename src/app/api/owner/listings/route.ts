import { sameOrigin, sessionUser } from "@/lib/admin";
import { createOwnerListing, moderationErrorResponse, ownerListings } from "@/lib/moderation";
import { requestJson } from "@/lib/request-json";

export async function GET(request: Request) {
  const user = await sessionUser(request.headers);
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  return Response.json({ listings: ownerListings(user.id) });
}

export async function POST(request: Request) {
  const user = await sessionUser(request.headers);
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  if (!sameOrigin(request)) return Response.json({ error: "Invalid origin" }, { status: 403 });
  let input: unknown;
  try { input = await requestJson(request); }
  catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  try {
    return Response.json({ listing: createOwnerListing(user.id, input) }, { status: 201 });
  } catch (error) {
    return moderationErrorResponse(error);
  }
}
