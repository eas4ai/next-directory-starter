import type { ThemeColors, ThemeDefinition } from "@/lib/theme-sdk";

const light = {
  background: "#F7F3E9", foreground: "#173049", card: "#FFFDF8",
  "card-foreground": "#173049", popover: "#FFFDF8", "popover-foreground": "#173049",
  primary: "#173B5B", "primary-foreground": "#FFFDF8", secondary: "#E8ECE5",
  "secondary-foreground": "#173049", muted: "#EEEADF", "muted-foreground": "#526577",
  accent: "#7F9F94", "accent-foreground": "#102C3F", destructive: "#A13B36",
  border: "#CBD2C8", input: "#9AA9A5", ring: "#173B5B",
  "chart-1": "#173B5B", "chart-2": "#7F9F94", "chart-3": "#526E7F",
  "chart-4": "#A4B8AE", "chart-5": "#8A765F", sidebar: "#173049",
  "sidebar-foreground": "#FFFDF8", "sidebar-primary": "#D7E4D9",
  "sidebar-primary-foreground": "#173049", "sidebar-accent": "#264660",
  "sidebar-accent-foreground": "#FFFDF8", "sidebar-border": "#3E5C70",
  "sidebar-ring": "#D7E4D9",
} satisfies ThemeColors;

const dark = {
  background: "#101C27", foreground: "#F3EFE5", card: "#172A39",
  "card-foreground": "#F3EFE5", popover: "#172A39", "popover-foreground": "#F3EFE5",
  primary: "#AFC9C0", "primary-foreground": "#10212E", secondary: "#213746",
  "secondary-foreground": "#F3EFE5", muted: "#1B3040", "muted-foreground": "#B4C0C3",
  accent: "#7F9F94", "accent-foreground": "#0C1B26", destructive: "#FF9B94",
  border: "#3F5664", input: "#607480", ring: "#AFC9C0",
  "chart-1": "#AFC9C0", "chart-2": "#91B2A6", "chart-3": "#95AFC3",
  "chart-4": "#D4C7AE", "chart-5": "#C9A49A", sidebar: "#0C1720",
  "sidebar-foreground": "#F3EFE5", "sidebar-primary": "#AFC9C0",
  "sidebar-primary-foreground": "#0C1720", "sidebar-accent": "#1B3040",
  "sidebar-accent-foreground": "#F3EFE5", "sidebar-border": "#3F5664",
  "sidebar-ring": "#AFC9C0",
} satisfies ThemeColors;

const northstarTheme = {
  id: "northstar-experts",
  name: "NORTHSTAR",
  light,
  dark,
  typography: {
    body: 'Inter, "Avenir Next", "Segoe UI", sans-serif',
    heading: 'Inter, "Avenir Next", "Segoe UI", sans-serif',
  },
  radius: "6px",
  shadow: "0 20px 55px rgb(23 48 73 / 10%)",
  controlHeight: "2.875rem",
  spacing: { section: "6rem", card: "1.25rem", gap: "1rem" },
  width: { page: "1360px", reading: "48rem" },
  social: { background: "#F7F3E9", foreground: "#173049", accent: "#173B5B", muted: "#7F9F94" },
} satisfies ThemeDefinition;

export default northstarTheme;
