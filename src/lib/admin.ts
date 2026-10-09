import { auth } from "@/lib/auth";

export async function isAdmin(headers: Headers): Promise<boolean> {
  const session = await auth.api.getSession({ headers });
  return session?.user.role?.split(",").includes("admin") ?? false;
}

export async function sessionUser(headers: Headers) {
  return (await auth.api.getSession({ headers }))?.user ?? null;
}

export function canModerate(role: string | null | undefined): boolean {
  return role?.split(",").some((value) => value === "admin" || value === "moderator") ?? false;
}

export function sameOrigin(request: Request): boolean {
  const origin = new URL(process.env.BETTER_AUTH_URL ?? request.url).origin;
  return request.headers.get("origin") === origin;
}
