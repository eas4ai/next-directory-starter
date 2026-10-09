import { canAdmin, sameOrigin, sessionUser } from "@/lib/admin";
import { accountErrorResponse, changeAccountSuspension } from "@/lib/accounts";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const user = await sessionUser(request.headers);
  if (!user || !canAdmin(user.role)) return Response.json({ error: "Forbidden" }, { status: 403 });
  if (!sameOrigin(request)) return Response.json({ error: "Invalid origin" }, { status: 403 });
  let input: Record<string, unknown>;
  try {
    const body = await request.text();
    if (body.length > 1024) throw new Error("Request is too large");
    const parsed: unknown = JSON.parse(body);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid JSON");
    input = parsed as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON or oversized request" }, { status: 400 });
  }
  try {
    return Response.json({ account: changeAccountSuspension(
      user.id, (await params).id, input.suspended, input.reason,
    ) });
  } catch (error) {
    return accountErrorResponse(error);
  }
}
