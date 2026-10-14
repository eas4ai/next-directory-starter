import { adminReadResponse, adminWriteGuard } from "@/lib/admin-api";
import { canAdmin, sessionUser } from "@/lib/admin";
import { requestJson, requestJsonErrorResponse } from "@/lib/request-json";
import { brandingErrorResponse, saveBranding } from "@/lib/branding";
import { getSiteConfig } from "@/lib/site-config";

export async function GET(request: Request) {
  return adminReadResponse(request, () => ({ branding: getSiteConfig() }));
}

export async function PATCH(request: Request) {
  const denied = await adminWriteGuard(request);
  if (denied) return denied;
  const user = await sessionUser(request.headers);
  if (!user || !canAdmin(user.role)) return Response.json({ error: "Forbidden" }, { status: 403 });
  let input: unknown;
  try { input = await requestJson(request, 8192); }
  catch (error) { return requestJsonErrorResponse(error); }
  try { return Response.json({ branding: saveBranding(input, user.id) }); }
  catch (error) { return brandingErrorResponse(error); }
}
