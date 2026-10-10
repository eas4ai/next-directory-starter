import { canManageBilling, sameOrigin, sessionUser } from "@/lib/admin";
import { planErrorResponse, updatePlan } from "@/lib/plans";

type Params = { params: Promise<{ key: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const user = await sessionUser(request.headers);
  if (!user || !canManageBilling(user.role)) return Response.json({ error: "Forbidden" }, { status: 403 });
  if (!sameOrigin(request)) return Response.json({ error: "Invalid origin" }, { status: 403 });
  let input: unknown;
  try {
    const body = await request.text();
    if (body.length > 8192) throw new Error("Request is too large");
    input = JSON.parse(body);
  } catch {
    return Response.json({ error: "Invalid JSON or oversized request" }, { status: 400 });
  }
  try {
    return Response.json({ plan: updatePlan((await params).key, input, user.id) });
  } catch (error) {
    return planErrorResponse(error);
  }
}
