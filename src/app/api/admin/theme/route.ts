import { canAdmin, sessionUser } from "@/lib/admin";
import { httpErrorResponse } from "@/lib/http-error";
import { requestJson, requestJsonErrorResponse } from "@/lib/request-json";
import { getThemePreset, parseThemePreset, saveThemePreset } from "@/lib/theme";

export async function GET(request: Request) {
  if (!canAdmin((await sessionUser(request.headers))?.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  return Response.json({ preset: getThemePreset() });
}

export async function POST(request: Request) {
  const user = await sessionUser(request.headers);
  if (!user || !canAdmin(user.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const siteOrigin = new URL(process.env.BETTER_AUTH_URL ?? request.url).origin;
  if (request.headers.get("origin") !== siteOrigin) {
    return Response.json({ error: "Invalid origin" }, { status: 403 });
  }

  let input: unknown;
  try {
    input = await requestJson(request, 8192);
  } catch (error) {
    return requestJsonErrorResponse(error);
  }
  const preset = parseThemePreset(input);
  if (!preset) {
    return Response.json({ error: "Invalid theme choice" }, { status: 400 });
  }

  try {
    saveThemePreset(preset, user.id);
    return Response.json({ preset });
  } catch (error) {
    return httpErrorResponse(error);
  }
}
