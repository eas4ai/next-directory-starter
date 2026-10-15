import type { ThemeDefinition } from "@/lib/theme-sdk";
import type { DirectoryProfileDefinition } from "@/lib/directory-profile-types";
import type { PublicTemplateDefinition } from "@/lib/public-template-sdk";

export const addonThemeDefinitions: ThemeDefinition[] = [];
export const addonTemplateOptions: readonly { id: string; name: string; supportedProfiles?: readonly { id: string; range: string }[] }[] = [];
export const addonTemplateDefinitions: PublicTemplateDefinition[] = [];
export const addonProfileDefinitions: readonly DirectoryProfileDefinition[] = [];
export const addonProfileMetadata: readonly { addonId: string; profileId: string; version: string; digest: string; schema: string }[] = [];
