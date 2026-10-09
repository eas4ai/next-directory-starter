import { auth } from "@/lib/auth";

export async function isAdmin(headers: Headers): Promise<boolean> {
  const session = await auth.api.getSession({ headers });
  return hasAnyRole(session?.user.role, ["admin"]);
}

export async function sessionUser(headers: Headers) {
  return (await auth.api.getSession({ headers }))?.user ?? null;
}

function hasAnyRole(role: string | null | undefined, allowed: readonly string[]): boolean {
  return role?.split(",").some((value) => allowed.includes(value)) ?? false;
}

export function canModerate(role: string | null | undefined): boolean {
  return hasAnyRole(role, ["admin", "moderator"]);
}

export function canEditArticles(role: string | null | undefined): boolean {
  return hasAnyRole(role, ["admin", "editor"]);
}

export function sameOrigin(request: Request): boolean {
  const origin = new URL(process.env.BETTER_AUTH_URL ?? request.url).origin;
  return request.headers.get("origin") === origin;
}
