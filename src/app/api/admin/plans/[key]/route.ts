import { canManageBilling, sameOrigin, sessionUser } from "@/lib/admin";
import { planErrorResponse, updatePlan } from "@/lib/plans";
import { requestJson, requestJsonErrorResponse } from "@/lib/request-json";

type Params = { params: Promise<{ key: string }> };

export async function PATCH(request: Request, { params }: Params) {
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
    return Response.json({ plan: updatePlan((await params).key, input, user.id) });
  } catch (error) {
    return planErrorResponse(error);
  }
}
