import { recordAudit } from "@/lib/audit";
import { isInstalledTheme, installedThemes } from "@/lib/theme-sdk";
import { readSiteSetting, writeSiteSetting } from "@/lib/site-settings";
import { database } from "@/lib/database";
import { addonTemplateOptions } from "@/addons/generated";

export const templateOptions = [
  { id: "classic", name: "Classic" },
  { id: "editorial", name: "Editorial" },
  ...addonTemplateOptions,
] as const;

export type ThemeSelection = { themeId: string; templateId: string };
export const defaultThemeSelection: ThemeSelection = {
  themeId: "preset", templateId: "classic",
};

export const themeChoices = [
  { id: "preset", name: "Saved preset" },
  ...Object.values(installedThemes).map(({ id, name }) => ({ id, name })),
];

function isTemplate(id: string): boolean {
  return templateOptions.some((option) => option.id === id);
}

export function parseThemeSelection(input: unknown): ThemeSelection | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const record = input as Record<string, unknown>;
  if (Object.keys(record).length !== 2 || typeof record.themeId !== "string" ||
      typeof record.templateId !== "string" || !isInstalledTheme(record.themeId) ||
      !isTemplate(record.templateId)) return null;
  return { themeId: record.themeId, templateId: record.templateId };
}

export function getThemeSelection(): ThemeSelection {
  const value = readSiteSetting("theme_selection");
  if (value === null) return defaultThemeSelection;
  try {
    const selection = parseThemeSelection(JSON.parse(value));
    // A removed theme or template must not take the site offline.
    return selection ?? defaultThemeSelection;
  } catch {
    return defaultThemeSelection;
  }
}

export function saveThemeSelection(input: unknown, actorId: string): ThemeSelection {
  const selection = parseThemeSelection(input);
  if (!selection) throw new Error("Invalid theme or template choice");
  database.transaction(() => {
    writeSiteSetting("theme_selection", JSON.stringify(selection));
    recordAudit("site.theme.select", actorId, `${selection.themeId}:${selection.templateId}`);
  }).immediate();
  return selection;
}
