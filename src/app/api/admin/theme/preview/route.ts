import { isAdmin } from "@/lib/admin";
import { requestJson, requestJsonErrorResponse } from "@/lib/request-json";
import { parseThemePreset, presetCss } from "@/lib/theme";

export async function POST(request: Request) {
  if (!(await isAdmin(request.headers))) {
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
  return Response.json({ preset, css: presetCss(preset, ".theme-preview") });
}
