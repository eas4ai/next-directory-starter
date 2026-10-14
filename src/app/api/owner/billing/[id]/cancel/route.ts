import { sameOrigin, sessionUser } from "@/lib/admin";
import { cancelOwnerPurchase, ownerBillingErrorResponse } from "@/lib/owner-billing";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await sessionUser(request.headers);
  if (!user) return Response.json({ error: "Sign in to continue" }, { status: 401 });
  if (!sameOrigin(request)) return Response.json({ error: "Invalid origin" }, { status: 403 });
  const { id } = await params;
  try { return Response.json(await cancelOwnerPurchase(user.id, id)); }
  catch (error) { return ownerBillingErrorResponse(error); }
}
