import { canAdmin, sameOrigin, sessionUser } from "@/lib/admin";
import { purgeArchivedProfileValues } from "@/lib/directory-profiles";
import { requestJson, requestJsonErrorResponse } from "@/lib/request-json";

type Input = {
  profileId?: unknown;
  fieldKey?: unknown;
  expectedCount?: unknown;
  expectedRevision?: unknown;
};

export async function DELETE(request: Request) {
  const user = await sessionUser(request.headers);
  if (!user || !canAdmin(user.role)) return Response.json({ error: "Forbidden" }, { status: 403 });
  if (!sameOrigin(request)) return Response.json({ error: "Invalid origin" }, { status: 403 });
  let raw: unknown;
  try { raw = await requestJson(request, 8192); }
  catch (error) { return requestJsonErrorResponse(error); }
  const input = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Input : {};
  if (typeof input.profileId !== "string" || typeof input.fieldKey !== "string" ||
      !Number.isSafeInteger(input.expectedCount) || !Number.isSafeInteger(input.expectedRevision)) {
    return Response.json({ error: "Profile, field, archived count, and revision are required" },
      { status: 400 });
  }
  try {
    const purged = purgeArchivedProfileValues({ profileId: input.profileId,
      fieldKey: input.fieldKey, expectedCount: input.expectedCount as number,
      expectedRevision: input.expectedRevision as number, actorUserId: user.id });
    return Response.json({ purged });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Purge failed" },
      { status: 400 });
  }
}
