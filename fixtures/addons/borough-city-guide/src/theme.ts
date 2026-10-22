import type { ThemeColors, ThemeDefinition } from "@/lib/theme-sdk";

const light = {
  background: "#F5EDE0", foreground: "#302C25", card: "#FFF8EC",
  "card-foreground": "#302C25", popover: "#FFF8EC", "popover-foreground": "#302C25",
  primary: "#A54A30", "primary-foreground": "#FFF8EC", secondary: "#E8DCC9",
  "secondary-foreground": "#302C25", muted: "#EDE3D3", "muted-foreground": "#665F54",
  accent: "#DDE1D4", "accent-foreground": "#374238", destructive: "#9C2F2F",
  border: "#CFC1AC", input: "#B9AA94", ring: "#A54A30",
  "chart-1": "#A54A30", "chart-2": "#839179", "chart-3": "#C88B5A",
  "chart-4": "#6D7B72", "chart-5": "#8A6655", sidebar: "#302C25",
  "sidebar-foreground": "#FFF8EC", "sidebar-primary": "#D47A5C",
  "sidebar-primary-foreground": "#241F1A", "sidebar-accent": "#4A443A",
  "sidebar-accent-foreground": "#FFF8EC", "sidebar-border": "#655C4F",
  "sidebar-ring": "#D47A5C",
} satisfies ThemeColors;

const dark = {
  background: "#1F1D19", foreground: "#F5EDE0", card: "#2B2822",
  "card-foreground": "#F5EDE0", popover: "#2B2822", "popover-foreground": "#F5EDE0",
  primary: "#E08A6C", "primary-foreground": "#1F1D19", secondary: "#39352E",
  "secondary-foreground": "#F5EDE0", muted: "#34312B", "muted-foreground": "#C9BDAA",
  accent: "#394239", "accent-foreground": "#F5EDE0", destructive: "#FF9A91",
  border: "#554E43", input: "#6B6255", ring: "#E08A6C",
  "chart-1": "#E08A6C", "chart-2": "#A8B59D", "chart-3": "#E4B17F",
  "chart-4": "#9EAEA2", "chart-5": "#C69B86", sidebar: "#171612",
  "sidebar-foreground": "#F5EDE0", "sidebar-primary": "#E08A6C",
  "sidebar-primary-foreground": "#171612", "sidebar-accent": "#2B2822",
  "sidebar-accent-foreground": "#F5EDE0", "sidebar-border": "#554E43",
  "sidebar-ring": "#E08A6C",
} satisfies ThemeColors;

const boroughTheme = {
  id: "borough-city-guide",
  name: "BOROUGH",
  light,
  dark,
  typography: {
    body: '"Avenir Next", "Segoe UI", sans-serif',
    heading: 'Iowan Old Style, "Palatino Linotype", Georgia, serif',
  },
  radius: "2px",
  shadow: "0 18px 45px rgb(48 44 37 / 12%)",
  controlHeight: "2.75rem",
  spacing: { section: "5.5rem", card: "1.25rem", gap: "1rem" },
  width: { page: "1360px", reading: "48rem" },
  social: { background: "#F5EDE0", foreground: "#302C25", accent: "#A54A30", muted: "#665F54" },
} satisfies ThemeDefinition;

export default boroughTheme;
