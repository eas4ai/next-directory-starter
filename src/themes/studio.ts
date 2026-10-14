import type { ThemeDefinition, ThemeColors } from "@/lib/theme-sdk";

const light = {
  background: "#f7f4ed", foreground: "#172d2b", card: "#fffdf8",
  "card-foreground": "#172d2b", popover: "#fffdf8", "popover-foreground": "#172d2b",
  primary: "#006e67", "primary-foreground": "#ffffff", secondary: "#e1eee8",
  "secondary-foreground": "#172d2b", muted: "#e9e8df", "muted-foreground": "#506461",
  accent: "#d5eadf", "accent-foreground": "#173b34", destructive: "#b32d32",
  border: "#c6d4cc", input: "#c6d4cc", ring: "#006e67",
  "chart-1": "#006e67", "chart-2": "#b56a43", "chart-3": "#79935c",
  "chart-4": "#5b7f9c", "chart-5": "#aa8c62",
  sidebar: "#173b34", "sidebar-foreground": "#f7f4ed",
  "sidebar-primary": "#80d8bc", "sidebar-primary-foreground": "#173b34",
  "sidebar-accent": "#285249", "sidebar-accent-foreground": "#f7f4ed",
  "sidebar-border": "#42665d", "sidebar-ring": "#80d8bc",
} satisfies ThemeColors;

const dark = {
  background: "#102321", foreground: "#e8f0e8", card: "#18312e",
  "card-foreground": "#e8f0e8", popover: "#18312e", "popover-foreground": "#e8f0e8",
  primary: "#80d8bc", "primary-foreground": "#102321", secondary: "#28413b",
  "secondary-foreground": "#e8f0e8", muted: "#28413b", "muted-foreground": "#afc5b8",
  accent: "#315c50", "accent-foreground": "#e8f0e8", destructive: "#ff8a8a",
  border: "#41645a", input: "#41645a", ring: "#80d8bc",
  "chart-1": "#80d8bc", "chart-2": "#d9a076", "chart-3": "#a9c982",
  "chart-4": "#94bed3", "chart-5": "#d7ba91",
  sidebar: "#0c1d1b", "sidebar-foreground": "#e8f0e8",
  "sidebar-primary": "#80d8bc", "sidebar-primary-foreground": "#102321",
  "sidebar-accent": "#28413b", "sidebar-accent-foreground": "#e8f0e8",
  "sidebar-border": "#41645a", "sidebar-ring": "#80d8bc",
} satisfies ThemeColors;

const studio = {
  id: "studio",
  name: "Studio",
  light,
  dark,
  typography: {
    body: 'Arial, ui-sans-serif, system-ui, sans-serif',
    heading: 'Georgia, ui-serif, serif',
  },
  radius: "0.5rem",
  shadow: "0 4px 18px rgb(12 45 39 / 10%)",
  controlHeight: "2.625rem",
  spacing: { section: "3.5rem", card: "1.75rem", gap: "1.25rem" },
  width: { page: "1280px", reading: "44rem" },
  social: {
    background: "#173b34", foreground: "#f7f4ed",
    accent: "#80d8bc", muted: "#b6d1c5",
  },
} satisfies ThemeDefinition;

export default studio;
