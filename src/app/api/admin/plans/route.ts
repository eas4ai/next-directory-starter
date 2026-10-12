import { canManageBilling, sameOrigin, sessionUser } from "@/lib/admin";
import { createPlan, listPlans, planErrorResponse } from "@/lib/plans";
import { requestJson, requestJsonErrorResponse } from "@/lib/request-json";

export async function GET(request: Request) {
  const user = await sessionUser(request.headers);
  if (!canManageBilling(user?.role)) return Response.json({ error: "Forbidden" }, { status: 403 });
  return Response.json({ plans: listPlans() });
}

export async function POST(request: Request) {
  const user = await sessionUser(request.headers);
  if (!user || !canManageBilling(user.role)) return Response.json({ error: "Forbidden" }, { status: 403 });
  if (!sameOrigin(request)) return Response.json({ error: "Invalid origin" }, { status: 403 });
  let input: unknown;
  try {
    input = await requestJson(request, 8192);
  } catch (error) {
    return requestJsonErrorResponse(error);
  }
  try {
    return Response.json({ plan: createPlan(input, user.id) }, { status: 201 });
  } catch (error) {
    return planErrorResponse(error);
  }
}
