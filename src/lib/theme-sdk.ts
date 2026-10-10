import { declarationBlock, presetCss, presetSocialColors, type ThemePreset } from "@/lib/theme";
import { themeDefinitions } from "@/themes";

export const colorTokenNames = [
  "background", "foreground", "card", "card-foreground", "popover",
  "popover-foreground", "primary", "primary-foreground", "secondary",
  "secondary-foreground", "muted", "muted-foreground", "accent",
  "accent-foreground", "destructive", "border", "input", "ring",
  "chart-1", "chart-2", "chart-3", "chart-4", "chart-5", "sidebar",
  "sidebar-foreground", "sidebar-primary", "sidebar-primary-foreground",
  "sidebar-accent", "sidebar-accent-foreground", "sidebar-border", "sidebar-ring",
] as const;

export type ColorToken = (typeof colorTokenNames)[number];
export type ThemeColors = Record<ColorToken, string>;

export type ThemeDefinition = {
  id: string;
  name: string;
  light: ThemeColors;
  dark: ThemeColors;
  typography: { body: string; heading: string };
  radius: string;
  shadow: string;
  controlHeight: string;
  spacing: { section: string; card: string; gap: string };
  width: { page: string; reading: string };
  social: { background: string; foreground: string; accent: string; muted: string };
};

const safeValue = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= 240 &&
  !/[{};\r\n]/.test(value) && !/url\s*\(|expression\s*\(|@import/i.test(value);

function requireValues(group: string, values: unknown, names: readonly string[]): void {
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    throw new Error(`Invalid ${group} tokens`);
  }
  const record = values as Record<string, unknown>;
  if (Object.keys(record).length !== names.length) {
    throw new Error(`Missing or extra ${group} token`);
  }
  for (const name of names) {
    if (!safeValue(record[name])) throw new Error(`Invalid ${group} token: ${name}`);
  }
}

export function defineTheme(definition: ThemeDefinition): ThemeDefinition {
  if (!definition || typeof definition.id !== "string" ||
      !/^[a-z][a-z0-9-]*$/.test(definition.id) || definition.id === "preset" ||
      typeof definition.name !== "string" || !definition.name.trim() ||
      definition.name.length > 80) {
    throw new Error("Invalid theme identity");
  }
  requireValues("light", definition.light, colorTokenNames);
  requireValues("dark", definition.dark, colorTokenNames);
  requireValues("typography", definition.typography, ["body", "heading"]);
  requireValues("spacing", definition.spacing, ["section", "card", "gap"]);
  requireValues("width", definition.width, ["page", "reading"]);
  requireValues("social", definition.social, ["background", "foreground", "accent", "muted"]);
  if (Object.values(definition.social).some((value) => !/^#[0-9a-fA-F]{6}$/.test(value))) {
    throw new Error("Social palette colors must be six-digit hex values");
  }
  for (const name of ["radius", "shadow", "controlHeight"] as const) {
    if (!safeValue(definition[name])) throw new Error(`Invalid theme token: ${name}`);
  }
  return definition;
}

export const installedThemes: Record<string, ThemeDefinition> = Object.fromEntries(
  themeDefinitions.map((definition) => {
    const theme = defineTheme(definition);
    return [theme.id, theme];
  }),
);
if (Object.keys(installedThemes).length !== themeDefinitions.length) {
  throw new Error("Theme IDs must be unique");
}

export function isInstalledTheme(id: string): boolean {
  return id === "preset" || Object.hasOwn(installedThemes, id);
}

function oklchToHex(value: string): string {
  const match = /^oklch\(([0-9.]+) ([0-9.]+) ([0-9.]+)\)$/.exec(value);
  if (!match) throw new Error("Invalid preset social color");
  const lightness = Number(match[1]);
  const chroma = Number(match[2]);
  const hue = Number(match[3]) * Math.PI / 180;
  const a = chroma * Math.cos(hue);
  const b = chroma * Math.sin(hue);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const channels = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -0.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return `#${channels.map((channel) => {
    const linear = Math.max(0, Math.min(1, channel));
    const srgb = linear <= 0.0031308 ? 12.92 * linear :
      1.055 * linear ** (1 / 2.4) - 0.055;
    return Math.round(srgb * 255).toString(16).padStart(2, "0");
  }).join("")}`;
}

export function socialPaletteForSelection(preset: ThemePreset, id: string): ThemeDefinition["social"] {
  if (!isInstalledTheme(id)) throw new Error("Unknown theme");
  if (id !== "preset") return installedThemes[id].social;
  const colors = presetSocialColors(preset);
  return { background: oklchToHex(colors.background),
    foreground: oklchToHex(colors.foreground),
    accent: oklchToHex(colors.accent), muted: oklchToHex(colors.muted) };
}

function themeVariables(theme: ThemeDefinition, mode: "light" | "dark"): Record<string, string> {
  return {
    ...theme[mode],
    "preset-body-font": theme.typography.body,
    "preset-heading-font": theme.typography.heading,
    radius: theme.radius,
    "preset-shadow": theme.shadow,
    "preset-control-height": theme.controlHeight,
    "theme-space-section": theme.spacing.section,
    "theme-space-card": theme.spacing.card,
    "theme-space-gap": theme.spacing.gap,
    "theme-page-width": theme.width.page,
    "theme-reading-width": theme.width.reading,
  };
}

function layoutTokens(selector: string): string {
  return declarationBlock(selector, {
    "theme-space-section": "3rem",
    "theme-space-card": "1.5rem",
    "theme-space-gap": "1rem",
    "theme-page-width": "1400px",
    "theme-reading-width": "48rem",
  });
}

export function renderThemeCss(preset: ThemePreset, id: string, selector: string): string {
  if (!isInstalledTheme(id)) throw new Error("Unknown theme");
  const base = presetCss(preset, selector);
  if (id === "preset") return `${base}\n${layoutTokens(selector)}`;
  const theme = installedThemes[id];
  const light = declarationBlock(selector, themeVariables(theme, "light"));
  const dark = declarationBlock(`${selector}[data-mode="dark"]`, themeVariables(theme, "dark"));
  const system = `@media (prefers-color-scheme: dark) { ${declarationBlock(
    `${selector}[data-mode="system"]`, themeVariables(theme, "dark"))} }`;
  return `${base}\n${light}\n${dark}\n${system}`;
}
