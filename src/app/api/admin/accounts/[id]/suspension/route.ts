import { canAdmin, sameOrigin, sessionUser } from "@/lib/admin";
import { accountErrorResponse, changeAccountSuspension } from "@/lib/accounts";
import { requestJson, requestJsonErrorResponse } from "@/lib/request-json";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const user = await sessionUser(request.headers);
  if (!user || !canAdmin(user.role)) return Response.json({ error: "Forbidden" }, { status: 403 });
  if (!sameOrigin(request)) return Response.json({ error: "Invalid origin" }, { status: 403 });
  let input: Record<string, unknown>;
  try {
    const parsed = await requestJson(request, 1024);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid JSON");
    input = parsed as Record<string, unknown>;
  } catch (error) {
    return requestJsonErrorResponse(error);
  }
  try {
    return Response.json({ account: changeAccountSuspension(
      user.id, (await params).id, input.suspended, input.reason,
    ) });
  } catch (error) {
    return accountErrorResponse(error);
  }
}
