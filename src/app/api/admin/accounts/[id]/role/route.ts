import { canAdmin, sameOrigin, sessionUser } from "@/lib/admin";
import { accountErrorResponse, changeAccountRole } from "@/lib/accounts";
import { requestJson, requestJsonErrorResponse } from "@/lib/request-json";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const user = await sessionUser(request.headers);
  if (!user || !canAdmin(user.role)) return Response.json({ error: "Forbidden" }, { status: 403 });
  if (!sameOrigin(request)) return Response.json({ error: "Invalid origin" }, { status: 403 });
  let input: unknown;
  try {
    input = await requestJson(request, 1024);
  } catch (error) {
    return requestJsonErrorResponse(error);
  }
  try {
    const role = input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>).role : undefined;
    return Response.json({ account: changeAccountRole(user.id, (await params).id, role) });
  } catch (error) {
    return accountErrorResponse(error);
  }
}
