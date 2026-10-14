import { adminReadResponse } from "@/lib/admin-api";
import { canAdmin, sameOrigin, sessionUser } from "@/lib/admin";
import { requestJson, requestJsonErrorResponse } from "@/lib/request-json";
import { getSeoSettings, saveSeoSettings, seoErrorResponse } from "@/lib/seo-settings";

export async function GET(request: Request) {
  return adminReadResponse(request, () => ({ settings: getSeoSettings() }));
}

export async function PATCH(request: Request) {
  const user = await sessionUser(request.headers);
  if (!user || !canAdmin(user.role)) return Response.json({ error: "Forbidden" }, { status: 403 });
  if (!sameOrigin(request)) return Response.json({ error: "Invalid origin" }, { status: 403 });
  let input: unknown;
  try { input = await requestJson(request, 8192); }
  catch (error) { return requestJsonErrorResponse(error); }
  try { return Response.json({ settings: saveSeoSettings(input, user.id) }); }
  catch (error) { return seoErrorResponse(error); }
}
