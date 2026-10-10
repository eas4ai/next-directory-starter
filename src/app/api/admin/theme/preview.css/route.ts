import { canAdmin, sessionUser } from "@/lib/admin";
import { isInstalledTheme, renderThemeCss } from "@/lib/theme-sdk";
import { parseThemePreset } from "@/lib/theme";

export async function GET(request: Request) {
  const user = await sessionUser(request.headers);
  if (!user || !canAdmin(user.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const query = new URL(request.url).searchParams;
  const input = query.get("preset") ?? "";
  const themeId = query.get("themeId") ?? "";
  const scope = query.get("scope") ?? "";
  if (input.length > 4096 || !isInstalledTheme(themeId) ||
      (scope !== "preset" && scope !== "selection")) {
    return Response.json({ error: "Invalid preview choice" }, { status: 400 });
  }
  let preset: ReturnType<typeof parseThemePreset>;
  try { preset = parseThemePreset(JSON.parse(input)); }
  catch { preset = null; }
  if (!preset) return Response.json({ error: "Invalid preset" }, { status: 400 });
  const selector = scope === "preset" ? ".preset-preview" : ".selection-preview";
  return new Response(renderThemeCss(preset, themeId, selector), {
    headers: {
      "Content-Type": "text/css; charset=utf-8",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
