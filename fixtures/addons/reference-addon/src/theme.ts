import type { ThemeColors, ThemeDefinition } from "@/lib/theme-sdk";

const light = {
  background: "#f4f7f5", foreground: "#183638", card: "#ffffff",
  "card-foreground": "#183638", popover: "#ffffff", "popover-foreground": "#183638",
  primary: "#2a7770", "primary-foreground": "#ffffff", secondary: "#dcebe5",
  "secondary-foreground": "#183638", muted: "#e9f0ed", "muted-foreground": "#526d6b",
  accent: "#cbe3da", "accent-foreground": "#183638", destructive: "#b8323a",
  border: "#bfd2cc", input: "#bfd2cc", ring: "#2a7770",
  "chart-1": "#2a7770", "chart-2": "#8eb4a5", "chart-3": "#d09962",
  "chart-4": "#657d9a", "chart-5": "#8f6f8c",
  sidebar: "#1e3b3d", "sidebar-foreground": "#f4f7f5",
  "sidebar-primary": "#8eb4a5", "sidebar-primary-foreground": "#183638",
  "sidebar-accent": "#31585a", "sidebar-accent-foreground": "#f4f7f5",
  "sidebar-border": "#4c6d6e", "sidebar-ring": "#8eb4a5",
} satisfies ThemeColors;

const dark = {
  background: "#102526", foreground: "#edf5f1", card: "#183536",
  "card-foreground": "#edf5f1", popover: "#183536", "popover-foreground": "#edf5f1",
  primary: "#8eb4a5", "primary-foreground": "#102526", secondary: "#294849",
  "secondary-foreground": "#edf5f1", muted: "#294849", "muted-foreground": "#b2c8c0",
  accent: "#35615e", "accent-foreground": "#edf5f1", destructive: "#ff9298",
  border: "#496b69", input: "#496b69", ring: "#8eb4a5",
  "chart-1": "#8eb4a5", "chart-2": "#d2ad83", "chart-3": "#8faec6",
  "chart-4": "#c39bbb", "chart-5": "#c4c97e",
  sidebar: "#0b1c1d", "sidebar-foreground": "#edf5f1",
  "sidebar-primary": "#8eb4a5", "sidebar-primary-foreground": "#102526",
  "sidebar-accent": "#294849", "sidebar-accent-foreground": "#edf5f1",
  "sidebar-border": "#496b69", "sidebar-ring": "#8eb4a5",
} satisfies ThemeColors;

const referenceAddon = {
  id: "reference-addon",
  name: "Reference Add-on",
  light,
  dark,
  typography: {
    body: "Arial, ui-sans-serif, system-ui, sans-serif",
    heading: "Georgia, ui-serif, serif",
  },
  radius: "0.625rem",
  shadow: "0 6px 20px rgb(24 54 56 / 12%)",
  controlHeight: "2.625rem",
  spacing: { section: "3.25rem", card: "1.5rem", gap: "1.25rem" },
  width: { page: "1320px", reading: "46rem" },
  social: {
    background: "#1e3b3d", foreground: "#f4f7f5",
    accent: "#8eb4a5", muted: "#bfd2cc",
  },
} satisfies ThemeDefinition;

export default referenceAddon;
