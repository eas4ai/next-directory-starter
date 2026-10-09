import { isAdmin, sameOrigin } from "@/lib/admin";

async function accessError(request: Request, write: boolean): Promise<Response | null> {
  if (!(await isAdmin(request.headers))) return Response.json({ error: "Forbidden" }, { status: 403 });
  if (write && !sameOrigin(request)) return Response.json({ error: "Invalid origin" }, { status: 403 });
  return null;
}

export async function adminReadResponse(request: Request, payload: () => unknown): Promise<Response> {
  const denied = await accessError(request, false);
  return denied ?? Response.json(payload());
}

export function adminWriteGuard(request: Request): Promise<Response | null> {
  return accessError(request, true);
}
