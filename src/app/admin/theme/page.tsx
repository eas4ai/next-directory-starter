import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { isAdmin } from "@/lib/admin";
import { getThemePreset, presetCss, themeOptions } from "@/lib/theme";
import { ThemeEditor } from "./theme-editor";

export const instant = false;

export default async function ThemePage() {
  if (!(await isAdmin(await headers()))) notFound();
  const preset = getThemePreset();

  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <div className="mb-8 max-w-2xl">
        <p className="text-sm font-medium text-muted-foreground">Site settings</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Theme</h1>
        <p className="mt-3 text-muted-foreground">Choose a preset and preview it before saving it for the directory.</p>
      </div>
      <ThemeEditor options={themeOptions} initialPreset={preset} initialCss={presetCss(preset, ".theme-preview")} />
    </main>
  );
}
