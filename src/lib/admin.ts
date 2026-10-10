import { auth } from "@/lib/auth";
import { hasRole, STAFF_CAPABILITIES } from "@/lib/staff-roles";

export async function isAdmin(headers: Headers): Promise<boolean> {
  return canAdmin((await sessionUser(headers))?.role);
}

export async function sessionUser(headers: Headers) {
  const user = (await auth.api.getSession({ headers }))?.user;
  return user?.emailVerified && !user.banned ? user : null;
}

function hasAnyRole(role: string | null | undefined, allowed: readonly string[]): boolean {
  return allowed.some((value) => hasRole(role, value));
}

export function canAdmin(role: string | null | undefined): boolean {
  return hasAnyRole(role, ["admin"]);
}

export function canModerate(role: string | null | undefined): boolean {
  return hasAnyRole(role, ["admin", "moderator"]);
}

export function canEditArticles(role: string | null | undefined): boolean {
  return hasAnyRole(role, ["admin", "editor"]);
}

export function canManageCatalog(role: string | null | undefined): boolean {
  return hasAnyRole(role, ["admin", "catalog"]);
}

export function canManageTaxonomy(role: string | null | undefined): boolean {
  return hasAnyRole(role, ["admin", "taxonomy"]);
}

export function canManageBilling(role: string | null | undefined): boolean {
  return hasAnyRole(role, ["admin", "billing", "catalog"]);
}

export function canOpenOverview(role: string | null | undefined): boolean {
  return canAdmin(role) || STAFF_CAPABILITIES.some((capability) => hasRole(role, capability));
}

export function sameOrigin(request: Request): boolean {
  const origin = new URL(process.env.BETTER_AUTH_URL ?? request.url).origin;
  return request.headers.get("origin") === origin;
}
