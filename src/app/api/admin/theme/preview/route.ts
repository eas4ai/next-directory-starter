import { isAdmin } from "@/lib/admin";
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
    const body = await request.text();
    if (body.length > 8192) throw new Error("Theme request is too large");
    input = JSON.parse(body);
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const preset = parseThemePreset(input);
  if (!preset) {
    return Response.json({ error: "Invalid theme choice" }, { status: 400 });
  }
  return Response.json({ preset, css: presetCss(preset, ".theme-preview") });
}
