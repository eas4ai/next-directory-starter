import { auth } from "@/lib/auth";

export async function isAdmin(headers: Headers): Promise<boolean> {
  const session = await auth.api.getSession({ headers });
  return session?.user.role?.split(",").includes("admin") ?? false;
}
