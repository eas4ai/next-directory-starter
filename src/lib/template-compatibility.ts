import { createRequire } from "node:module";
import { addonTemplateOptions } from "@/addons/generated";
import type { ActiveProfileSet } from "@/lib/directory-profile-types";

const semver = createRequire(import.meta.url)("semver") as {
  satisfies(version: string, range: string, options?: { includePrerelease?: boolean }): boolean;
};

export function templateSupportsProfiles(templateId: string, profiles: ActiveProfileSet): boolean {
  const option = addonTemplateOptions.find(({ id }) => id === templateId);
  const supported = option?.supportedProfiles;
  if (!supported?.length) return true;
  const base = profiles.state.base;
  return base !== null && supported.some(({ id, range }) =>
    id === base.profileId && semver.satisfies(base.version, range, { includePrerelease: true }));
}
