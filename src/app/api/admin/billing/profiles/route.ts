import { canManageBilling, sameOrigin, sessionUser } from "@/lib/admin";
import { billingProfileErrorResponse, listBillingProfiles, saveBillingProfile } from "@/lib/billing-profiles";
import { requestJson, requestJsonErrorResponse } from "@/lib/request-json";

export async function GET(request: Request) {
  const user = await sessionUser(request.headers);
  if (!user || !canManageBilling(user.role)) return Response.json({ error: "Forbidden" }, { status: 403 });
  return Response.json({ profiles: listBillingProfiles() });
}

export async function PUT(request: Request) {
  const user = await sessionUser(request.headers);
  if (!user || !canManageBilling(user.role)) return Response.json({ error: "Forbidden" }, { status: 403 });
  if (!sameOrigin(request)) return Response.json({ error: "Invalid origin" }, { status: 403 });
  let input: unknown;
  try { input = await requestJson(request, 16384); }
  catch (error) { return requestJsonErrorResponse(error); }
  try {
    return Response.json({ profile: saveBillingProfile(input, user.id) });
  } catch (error) {
    return billingProfileErrorResponse(error);
  }
}
