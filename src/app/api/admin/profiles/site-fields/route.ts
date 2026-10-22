import { canAdmin, sameOrigin, sessionUser } from "@/lib/admin";
import { archiveSiteField, saveSiteField } from "@/lib/directory-profiles";
import { requestJson, requestJsonErrorResponse } from "@/lib/request-json";

type Input = { field?: unknown; fieldKey?: unknown; expectedRevision?: unknown };

async function inputFor(request: Request): Promise<Input | Response> {
  try {
    const raw = await requestJson(request, 256 * 1024);
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Input : {};
  } catch (error) { return requestJsonErrorResponse(error); }
}

async function actor(request: Request) {
  const user = await sessionUser(request.headers);
  if (!user || !canAdmin(user.role)) return null;
  return user;
}

export async function POST(request: Request) {
  const user = await actor(request);
  if (!user) return Response.json({ error: "Forbidden" }, { status: 403 });
  if (!sameOrigin(request)) return Response.json({ error: "Invalid origin" }, { status: 403 });
  const input = await inputFor(request);
  if (input instanceof Response) return input;
  if (!Number.isSafeInteger(input.expectedRevision) || !input.field) {
    return Response.json({ error: "Field and revision are required" }, { status: 400 });
  }
  try {
    return Response.json({ state: saveSiteField({ field: input.field,
      expectedRevision: input.expectedRevision as number, actorUserId: user.id }) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Site field save failed" },
      { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const user = await actor(request);
  if (!user) return Response.json({ error: "Forbidden" }, { status: 403 });
  if (!sameOrigin(request)) return Response.json({ error: "Invalid origin" }, { status: 403 });
  const input = await inputFor(request);
  if (input instanceof Response) return input;
  if (!Number.isSafeInteger(input.expectedRevision) || typeof input.fieldKey !== "string") {
    return Response.json({ error: "Field key and revision are required" }, { status: 400 });
  }
  try {
    return Response.json({ state: archiveSiteField({ fieldKey: input.fieldKey,
      expectedRevision: input.expectedRevision as number, actorUserId: user.id }) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Site field archive failed" },
      { status: 400 });
  }
}
