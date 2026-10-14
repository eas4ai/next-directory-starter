import { canAdmin, sameOrigin, sessionUser } from "@/lib/admin";
import { requestJson, requestJsonErrorResponse } from "@/lib/request-json";
import { getThemeSelection, parseThemeSelection, saveThemeSelection, templateOptions,
  themeChoices } from "@/lib/theme-selection";

export async function GET(request: Request) {
  const user = await sessionUser(request.headers);
  if (!user || !canAdmin(user.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  return Response.json({ selection: getThemeSelection(), themes: themeChoices,
    templates: templateOptions }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request) {
  const user = await sessionUser(request.headers);
  if (!user || !canAdmin(user.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!sameOrigin(request)) {
    return Response.json({ error: "Invalid origin" }, { status: 403 });
  }
  let input: unknown;
  try { input = await requestJson(request, 1024); }
  catch (error) { return requestJsonErrorResponse(error); }
  const selection = parseThemeSelection(input);
  if (!selection) return Response.json({ error: "Invalid theme or template choice" }, { status: 400 });
  return Response.json({ selection: saveThemeSelection(selection, user.id) });
}
