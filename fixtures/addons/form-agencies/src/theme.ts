import type { ThemeColors, ThemeDefinition } from "@/lib/theme-sdk";

const light = {
  background: "#F2EFE5", foreground: "#171717", card: "#FFFDF8", "card-foreground": "#171717",
  popover: "#FFFDF8", "popover-foreground": "#171717", primary: "#EE522E",
  "primary-foreground": "#171717", secondary: "#E8EA50", "secondary-foreground": "#171717",
  muted: "#E6E1D6", "muted-foreground": "#5D5A54", accent: "#E8EA50",
  "accent-foreground": "#171717", destructive: "#B92F27", border: "#171717", input: "#56544F",
  ring: "#EE522E", "chart-1": "#EE522E", "chart-2": "#E8EA50", "chart-3": "#171717",
  "chart-4": "#8A8275", "chart-5": "#BF7A62", sidebar: "#171717", "sidebar-foreground": "#F2EFE5",
  "sidebar-primary": "#E8EA50", "sidebar-primary-foreground": "#171717", "sidebar-accent": "#2C2C2C",
  "sidebar-accent-foreground": "#FFFDF8", "sidebar-border": "#5B5B5B", "sidebar-ring": "#EE522E",
} satisfies ThemeColors;
const dark = {
  background: "#151515", foreground: "#F2EFE5", card: "#202020", "card-foreground": "#F2EFE5",
  popover: "#202020", "popover-foreground": "#F2EFE5", primary: "#FF6C49",
  "primary-foreground": "#151515", secondary: "#E8EA50", "secondary-foreground": "#151515",
  muted: "#292929", "muted-foreground": "#C5C0B7", accent: "#E8EA50",
  "accent-foreground": "#151515", destructive: "#FF8B83", border: "#777268", input: "#928C82",
  ring: "#FF6C49", "chart-1": "#FF6C49", "chart-2": "#E8EA50", "chart-3": "#F2EFE5",
  "chart-4": "#A69F93", "chart-5": "#D99C85", sidebar: "#0D0D0D", "sidebar-foreground": "#F2EFE5",
  "sidebar-primary": "#E8EA50", "sidebar-primary-foreground": "#151515", "sidebar-accent": "#292929",
  "sidebar-accent-foreground": "#FFFDF8", "sidebar-border": "#55514A", "sidebar-ring": "#FF6C49",
} satisfies ThemeColors;
const formTheme = {
  id: "form-agencies", name: "FORM", light, dark,
  typography: { body: '"Arial Narrow", "Helvetica Neue", Arial, sans-serif', heading: 'Impact, Haettenschweiler, "Arial Narrow Bold", sans-serif' },
  radius: "0px", shadow: "9px 9px 0 rgb(23 23 23 / 14%)", controlHeight: "3rem",
  spacing: { section: "6.5rem", card: "1.15rem", gap: "1rem" }, width: { page: "1440px", reading: "46rem" },
  social: { background: "#F2EFE5", foreground: "#171717", accent: "#EE522E", muted: "#E8EA50" },
} satisfies ThemeDefinition;
export default formTheme;
