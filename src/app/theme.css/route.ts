import { getThemePreset } from "@/lib/theme";
import { renderThemeCss } from "@/lib/theme-sdk";
import { getThemeSelection } from "@/lib/theme-selection";
import { connection } from "next/server";

export async function GET() {
  await connection();
  const preset = getThemePreset();
  const selection = getThemeSelection();
  return new Response(renderThemeCss(preset, selection.themeId, ":root"), {
    headers: {
      "Content-Type": "text/css; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
