import themeData from "@/lib/theme-options.json";
import { database } from "@/lib/database";

export const themeOptions = themeData.options;
export type ThemePreset = Record<keyof typeof themeOptions, string>;
export const defaultThemePreset = themeData.defaults as ThemePreset;

const fields = Object.keys(themeOptions) as (keyof ThemePreset)[];

database.exec(`CREATE TABLE IF NOT EXISTS site_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
)`);

export function parseThemePreset(value: unknown): ThemePreset | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== fields.length) return null;
  for (const field of fields) {
    if (typeof record[field] !== "string" || !themeOptions[field].includes(record[field])) return null;
  }
  return record as ThemePreset;
}

export function getThemePreset(): ThemePreset {
  const row = database.prepare("SELECT value FROM site_settings WHERE key = ?")
    .get("theme") as { value: string } | undefined;
  if (!row) return defaultThemePreset;
  const preset = parseThemePreset(JSON.parse(row.value));
  if (!preset) throw new Error("Stored theme preset is invalid.");
  return preset;
}

export function saveThemePreset(preset: ThemePreset): void {
  database.prepare("INSERT INTO site_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run("theme", JSON.stringify(preset));
}

const baseColors: Record<string, [number, number]> = {
  neutral: [0, 0], stone: [55, 0.012], zinc: [290, 0.01], gray: [260, 0.012],
  mauve: [325, 0.018], olive: [115, 0.02], mist: [225, 0.014], taupe: [43, 0.018],
};

const accentHues: Record<string, number> = {
  amber: 75, blue: 264, cyan: 210, emerald: 165, fuchsia: 325,
  green: 145, indigo: 277, lime: 130, orange: 50, pink: 350,
  purple: 305, red: 28, rose: 15, sky: 235, teal: 185,
  violet: 295, yellow: 100,
};

const styleControls: Record<string, [string, string]> = {
  nova: ["2.25rem", "0 1px 2px oklch(0 0 0 / 8%)"],
  vega: ["2.5rem", "0 2px 6px oklch(0 0 0 / 12%)"],
  maia: ["2.75rem", "0 4px 12px oklch(0 0 0 / 10%)"],
  lyra: ["2rem", "none"],
  mira: ["2.375rem", "0 1px 5px oklch(0 0 0 / 15%)"],
  luma: ["2.625rem", "0 6px 18px oklch(0 0 0 / 10%)"],
  sera: ["2.125rem", "0 2px 4px oklch(0 0 0 / 10%)"],
  rhea: ["2.875rem", "0 8px 20px oklch(0 0 0 / 12%)"],
};

const radii: Record<string, string> = {
  default: "0.625rem", none: "0", small: "0.375rem", medium: "0.625rem", large: "0.875rem",
};

function color(lightness: number, chroma: number, hue: number, alpha?: number): string {
  return `oklch(${lightness} ${chroma} ${hue}${alpha === undefined ? "" : ` / ${alpha}`})`;
}

function fontName(slug: string): string {
  const names: Record<string, string> = {
    "dm-sans": "DM Sans",
    "eb-garamond": "EB Garamond",
    "ibm-plex-sans": "IBM Plex Sans",
    "jetbrains-mono": "JetBrains Mono",
  };
  return names[slug] ?? slug.split("-").map((part) => part[0].toUpperCase() + part.slice(1)).join(" ");
}

function fontFamily(slug: string): string {
  const name = fontName(slug);
  return `"${name}", ${slug.includes("mono") ? "ui-monospace, monospace" : "ui-sans-serif, system-ui, sans-serif"}`;
}

function variables(preset: ThemePreset, dark: boolean): Record<string, string> {
  const [baseHue, baseChroma] = baseColors[preset.baseColor];
  const themeHue = accentHues[preset.theme] ?? baseColors[preset.theme]?.[0] ?? 0;
  const themeChroma = preset.theme in accentHues ? 0.2 : baseColors[preset.theme]?.[1] ?? 0;
  const chartHue = accentHues[preset.chartColor] ?? baseColors[preset.chartColor]?.[0] ?? 0;
  const chartChroma = preset.chartColor in accentHues ? 0.16 : baseColors[preset.chartColor]?.[1] ?? 0;
  const surface = color(dark ? 0.15 : 1, baseChroma * (dark ? 0.4 : 0), baseHue);
  const foreground = color(dark ? 0.985 : 0.18, baseChroma, baseHue);
  const card = color(dark ? 0.22 : 1, baseChroma * 0.5, baseHue);
  const muted = color(dark ? 0.29 : 0.96, baseChroma * 0.5, baseHue);
  const primary = color(dark ? 0.67 : 0.52, themeChroma, themeHue);
  const primaryForeground = dark ? color(0.14, 0.02, themeHue) : color(0.99, 0.005, themeHue);
  const menuInverted = preset.menuColor.startsWith("inverted");
  const menuTranslucent = preset.menuColor.endsWith("translucent");
  const menuAlpha = menuTranslucent ? 0.85 : undefined;
  const menuBackground = menuInverted
    ? color(dark ? 0.93 : 0.21, baseChroma, baseHue, menuAlpha)
    : color(dark ? 0.22 : 1, baseChroma * 0.5, baseHue, menuAlpha);
  const menuForeground = menuInverted ? color(dark ? 0.2 : 0.97, baseChroma, baseHue) : foreground;
  const menuAccent = preset.menuAccent === "bold" ? primary : muted;
  const menuAccentForeground = preset.menuAccent === "bold" ? primaryForeground : menuForeground;
  const [controlHeight, shadow] = styleControls[preset.style];
  const chart = [0.85, 0.73, 0.61, 0.49, 0.37].map((level) => color(level, chartChroma, chartHue));

  return {
    background: surface, foreground, card, "card-foreground": foreground,
    popover: card, "popover-foreground": foreground,
    primary, "primary-foreground": primaryForeground,
    secondary: muted, "secondary-foreground": foreground,
    muted, "muted-foreground": color(dark ? 0.72 : 0.54, baseChroma, baseHue),
    accent: muted, "accent-foreground": foreground,
    border: color(dark ? 0.36 : 0.89, baseChroma * 0.5, baseHue),
    input: color(dark ? 0.4 : 0.89, baseChroma * 0.5, baseHue),
    ring: primary,
    "chart-1": chart[0], "chart-2": chart[1], "chart-3": chart[2],
    "chart-4": chart[3], "chart-5": chart[4],
    radius: radii[preset.radius],
    sidebar: menuBackground,
    "sidebar-foreground": menuForeground,
    "sidebar-primary": primary,
    "sidebar-primary-foreground": primaryForeground,
    "sidebar-accent": menuAccent,
    "sidebar-accent-foreground": menuAccentForeground,
    "sidebar-border": color(dark ? 0.36 : 0.89, baseChroma * 0.5, baseHue),
    "sidebar-ring": primary,
    "preset-body-font": fontFamily(preset.font),
    "preset-heading-font": fontFamily(preset.fontHeading === "inherit" ? preset.font : preset.fontHeading),
    "preset-control-height": controlHeight,
    "preset-shadow": shadow,
    "preset-icon-library": `"${preset.iconLibrary}"`,
  };
}

function declarationBlock(selector: string, values: Record<string, string>): string {
  return `${selector} { ${Object.entries(values).map(([name, value]) => `--${name}: ${value};`).join(" ")} }`;
}

export function presetCss(preset: ThemePreset, selector: string): string {
  const fonts = [...new Set([preset.font, preset.fontHeading === "inherit" ? preset.font : preset.fontHeading])];
  const imports = fonts.map((font) => `@import url("https://fonts.googleapis.com/css2?family=${encodeURIComponent(fontName(font))}&display=swap");`).join("\n");
  const light = declarationBlock(selector, variables(preset, false));
  const dark = declarationBlock(`${selector}[data-mode="dark"]`, variables(preset, true));
  const system = `@media (prefers-color-scheme: dark) { ${declarationBlock(`${selector}[data-mode="system"]`, variables(preset, true))} }`;
  return `${imports}\n${light}\n${dark}\n${system}`;
}
