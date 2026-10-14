export const STAFF_CAPABILITIES = ["moderator", "editor", "catalog", "taxonomy", "billing"] as const;
export type StaffCapability = typeof STAFF_CAPABILITIES[number];

export function hasRole(role: string | null | undefined, value: string): boolean {
  return role?.split(",").includes(value) ?? false;
}

export function canonicalAccountRole(input: unknown): string | null {
  if (input === "user" || input === "admin") return input;
  if (typeof input !== "string") return null;
  const chosen = input.split(",");
  if (chosen.length === 0 || chosen.length > STAFF_CAPABILITIES.length ||
      chosen.some((capability) => !STAFF_CAPABILITIES.includes(capability as StaffCapability)) ||
      new Set(chosen).size !== chosen.length) return null;
  return STAFF_CAPABILITIES.filter((capability) => chosen.includes(capability)).join(",");
}
