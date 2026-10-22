import type { ThemeColors, ThemeDefinition } from "@/lib/theme-sdk";

const light = {
  background: "#F5EEDF", foreground: "#171A17", card: "#FFF9EC",
  "card-foreground": "#171A17", popover: "#FFF9EC", "popover-foreground": "#171A17",
  primary: "#F05A2D", "primary-foreground": "#171A17", secondary: "#E9E8B9",
  "secondary-foreground": "#171A17", muted: "#E9E8B9", "muted-foreground": "#55584F",
  accent: "#E9E8B9", "accent-foreground": "#171A17", destructive: "#A72F21",
  border: "#171A17", input: "#77786D", ring: "#F05A2D",
  "chart-1": "#F05A2D", "chart-2": "#A7AA55", "chart-3": "#171A17",
  "chart-4": "#E9E8B9", "chart-5": "#8B3A23", sidebar: "#171A17",
  "sidebar-foreground": "#F5EEDF", "sidebar-primary": "#F05A2D",
  "sidebar-primary-foreground": "#171A17", "sidebar-accent": "#30342E",
  "sidebar-accent-foreground": "#FFF9EC", "sidebar-border": "#565A50",
  "sidebar-ring": "#F05A2D",
} satisfies ThemeColors;

const dark = {
  background: "#171A17", foreground: "#F5EEDF", card: "#22251F",
  "card-foreground": "#FFF9EC", popover: "#22251F", "popover-foreground": "#FFF9EC",
  primary: "#FF754A", "primary-foreground": "#171A17", secondary: "#35372E",
  "secondary-foreground": "#F5EEDF", muted: "#2B2E28", "muted-foreground": "#C8C5B6",
  accent: "#3D402F", "accent-foreground": "#FFF9EC", destructive: "#FF9382",
  border: "#77786D", input: "#8C8D80", ring: "#FF754A",
  "chart-1": "#FF754A", "chart-2": "#E9E8B9", "chart-3": "#FFF9EC",
  "chart-4": "#A7AA55", "chart-5": "#C75A38", sidebar: "#10120F",
  "sidebar-foreground": "#F5EEDF", "sidebar-primary": "#FF754A",
  "sidebar-primary-foreground": "#171A17", "sidebar-accent": "#292C26",
  "sidebar-accent-foreground": "#FFF9EC", "sidebar-border": "#565A50",
  "sidebar-ring": "#FF754A",
} satisfies ThemeColors;

const nowNextTheme = {
  id: "now-next-events",
  name: "NOW/NEXT",
  light,
  dark,
  typography: {
    body: '"Arial Narrow", "Roboto Condensed", "Helvetica Neue", sans-serif',
    heading: 'Impact, Haettenschweiler, "Arial Narrow Bold", sans-serif',
  },
  radius: "0px",
  shadow: "8px 8px 0 rgb(23 26 23 / 18%)",
  controlHeight: "3rem",
  spacing: { section: "5rem", card: "1rem", gap: "1rem" },
  width: { page: "1440px", reading: "48rem" },
  social: { background: "#F5EEDF", foreground: "#171A17", accent: "#F05A2D", muted: "#55584F" },
} satisfies ThemeDefinition;

export default nowNextTheme;
