import { adminReadResponse } from "@/lib/admin-api";
import { canAdmin, sameOrigin, sessionUser } from "@/lib/admin";
import { createPlan, listPlans, planErrorResponse } from "@/lib/plans";

export async function GET(request: Request) {
  return adminReadResponse(request, () => ({ plans: listPlans() }));
}

export async function POST(request: Request) {
  const user = await sessionUser(request.headers);
  if (!user || !canAdmin(user.role)) return Response.json({ error: "Forbidden" }, { status: 403 });
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
    return Response.json({ plan: createPlan(input, user.id) }, { status: 201 });
  } catch (error) {
    return planErrorResponse(error);
  }
}
