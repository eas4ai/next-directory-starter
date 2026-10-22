import studio from "@/themes/studio";
import { addonThemeDefinitions } from "@/addons/generated";

// Register new theme definitions here. The SDK validates every entry at startup.
export const themeDefinitions = [studio, ...addonThemeDefinitions];
