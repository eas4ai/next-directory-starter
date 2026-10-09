import { canAdmin, sameOrigin, sessionUser } from "@/lib/admin";
import { accountErrorResponse, changeAccountRole } from "@/lib/accounts";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const user = await sessionUser(request.headers);
  if (!canAdmin(user?.role)) return Response.json({ error: "Forbidden" }, { status: 403 });
  if (!sameOrigin(request)) return Response.json({ error: "Invalid origin" }, { status: 403 });
  let input: unknown;
  try {
    const body = await request.text();
    if (body.length > 1024) throw new Error("Request is too large");
    input = JSON.parse(body);
  } catch {
    return Response.json({ error: "Invalid JSON or oversized request" }, { status: 400 });
  }
  try {
    const role = input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>).role : undefined;
    return Response.json({ account: changeAccountRole(user.id, (await params).id, role) });
  } catch (error) {
    return accountErrorResponse(error);
  }
}
