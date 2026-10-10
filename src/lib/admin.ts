import { auth } from "@/lib/auth";

export async function isAdmin(headers: Headers): Promise<boolean> {
  const session = await auth.api.getSession({ headers });
  return canAdmin(session?.user.role);
}

export async function sessionUser(headers: Headers) {
  return (await auth.api.getSession({ headers }))?.user ?? null;
}

function hasAnyRole(role: string | null | undefined, allowed: readonly string[]): boolean {
  return role?.split(",").some((value) => allowed.includes(value)) ?? false;
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

export function canOpenOverview(role: string | null | undefined): boolean {
  return hasAnyRole(role, ["admin", "moderator", "editor"]);
}

export function sameOrigin(request: Request): boolean {
  const origin = new URL(process.env.BETTER_AUTH_URL ?? request.url).origin;
  return request.headers.get("origin") === origin;
}
