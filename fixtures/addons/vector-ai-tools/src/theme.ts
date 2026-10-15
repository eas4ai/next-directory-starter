import type { ThemeColors, ThemeDefinition } from "@/lib/theme-sdk";

const light = {
  background: "#F4F7FF", foreground: "#111A2B", card: "#FFFFFF",
  "card-foreground": "#111A2B", popover: "#FFFFFF", "popover-foreground": "#111A2B",
  primary: "#315FD5", "primary-foreground": "#FFFFFF", secondary: "#E6ECFA",
  "secondary-foreground": "#17243B", muted: "#E9EEF8", "muted-foreground": "#55637A",
  accent: "#DCE6FF", "accent-foreground": "#183E97", destructive: "#B3263B",
  border: "#C8D2E5", input: "#AFBCD3", ring: "#315FD5",
  "chart-1": "#315FD5", "chart-2": "#167455", "chart-3": "#7B56C5",
  "chart-4": "#C1672B", "chart-5": "#5C6E91", sidebar: "#111A2B",
  "sidebar-foreground": "#F4F7FF", "sidebar-primary": "#81A4FF",
  "sidebar-primary-foreground": "#0A1020", "sidebar-accent": "#213253",
  "sidebar-accent-foreground": "#EDF2FF", "sidebar-border": "#344568",
  "sidebar-ring": "#81A4FF",
} satisfies ThemeColors;

const dark = {
  background: "#0A1020", foreground: "#EDF2FF", card: "#141D30",
  "card-foreground": "#EDF2FF", popover: "#141D30", "popover-foreground": "#EDF2FF",
  primary: "#81A4FF", "primary-foreground": "#0A1020", secondary: "#1A2740",
  "secondary-foreground": "#EDF2FF", muted: "#18243A", "muted-foreground": "#A9B7D0",
  accent: "#233A68", "accent-foreground": "#EDF2FF", destructive: "#FF8797",
  border: "#2B3A58", input: "#40516F", ring: "#81A4FF",
  "chart-1": "#81A4FF", "chart-2": "#A9B7D0", "chart-3": "#C1A3FF",
  "chart-4": "#FFB47D", "chart-5": "#93A4C3", sidebar: "#0A1020",
  "sidebar-foreground": "#EDF2FF", "sidebar-primary": "#81A4FF",
  "sidebar-primary-foreground": "#0A1020", "sidebar-accent": "#141D30",
  "sidebar-accent-foreground": "#EDF2FF", "sidebar-border": "#2B3A58",
  "sidebar-ring": "#81A4FF",
} satisfies ThemeColors;

const vectorTheme = {
  id: "vector-ai-tools",
  name: "VECTOR",
  light,
  dark,
  typography: {
    body: '"Inter", "Segoe UI", sans-serif',
    heading: '"Arial Narrow", "Roboto Condensed", sans-serif',
  },
  radius: "5px",
  shadow: "0 18px 50px rgb(10 16 32 / 18%)",
  controlHeight: "2.5rem",
  spacing: { section: "4rem", card: "1rem", gap: "0.75rem" },
  width: { page: "1440px", reading: "54rem" },
  social: { background: "#0A1020", foreground: "#EDF2FF", accent: "#81A4FF", muted: "#A9B7D0" },
} satisfies ThemeDefinition;

export default vectorTheme;
