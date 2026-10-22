import { adminReadResponse } from "@/lib/admin-api";
import { canAdmin, sameOrigin, sessionUser } from "@/lib/admin";
import { requestJson, requestJsonErrorResponse } from "@/lib/request-json";
import { deleteRedirect, listRedirects, redirectErrorResponse, saveRedirect } from "@/lib/seo-redirects";

export async function GET(request: Request) {
  return adminReadResponse(request, () => ({ redirects: listRedirects() }));
}

async function change(request: Request, remove: boolean): Promise<Response> {
  const user = await sessionUser(request.headers);
  if (!user || !canAdmin(user.role)) return Response.json({ error: "Forbidden" }, { status: 403 });
  if (!sameOrigin(request)) return Response.json({ error: "Invalid origin" }, { status: 403 });
  let input: unknown;
  try { input = await requestJson(request, 4096); }
  catch (error) { return requestJsonErrorResponse(error); }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return Response.json({ error: "Invalid redirect" }, { status: 400 });
  }
  const value = input as Record<string, unknown>;
  try {
    if (remove) {
      deleteRedirect(value.source, user.id);
      return Response.json({ ok: true });
    }
    return Response.json({ redirect: saveRedirect(value.source, value.destination, user.id) });
  } catch (error) { return redirectErrorResponse(error); }
}

export const POST = (request: Request) => change(request, false);
export const DELETE = (request: Request) => change(request, true);
