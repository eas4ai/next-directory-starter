import { canAdmin, sameOrigin, sessionUser } from "@/lib/admin";
import {
  archivedProfileValueCount, availableDirectoryProfileDefinition, profileImpact,
} from "@/lib/directory-profiles";
import type { ProfileMigrationPlan } from "@/lib/directory-profile-types";
import { requestJson, requestJsonErrorResponse } from "@/lib/request-json";

type Input = {
  profileId?: unknown;
  version?: unknown;
  expectedRevision?: unknown;
  migration?: unknown;
  purge?: unknown;
};

export async function POST(request: Request) {
  const user = await sessionUser(request.headers);
  if (!user || !canAdmin(user.role)) return Response.json({ error: "Forbidden" }, { status: 403 });
  if (!sameOrigin(request)) return Response.json({ error: "Invalid origin" }, { status: 403 });
  let raw: unknown;
  try { raw = await requestJson(request, 256 * 1024); }
  catch (error) { return requestJsonErrorResponse(error); }
  const input = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Input : {};
  const purge = input.purge && typeof input.purge === "object" && !Array.isArray(input.purge)
    ? input.purge as Record<string, unknown> : null;
  if (purge && typeof purge.profileId === "string" && typeof purge.fieldKey === "string" &&
      Number.isSafeInteger(input.expectedRevision)) {
    try {
      const archivedCount = archivedProfileValueCount({ profileId: purge.profileId,
        fieldKey: purge.fieldKey, expectedRevision: input.expectedRevision as number });
      return Response.json({ purge: { profileId: purge.profileId, fieldKey: purge.fieldKey,
        archivedCount, stateRevision: input.expectedRevision } });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "Impact analysis failed" },
        { status: 400 });
    }
  }
  if (typeof input.profileId !== "string" || typeof input.version !== "string" ||
      !Number.isSafeInteger(input.expectedRevision)) {
    return Response.json({ error: "Profile, version, and revision are required" }, { status: 400 });
  }
  try {
    const definition = availableDirectoryProfileDefinition(input.profileId, input.version);
    return Response.json({ impact: profileImpact({ definition,
      expectedRevision: input.expectedRevision as number,
      migration: input.migration as ProfileMigrationPlan | undefined }), definition });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Impact analysis failed" },
      { status: 400 });
  }
}
