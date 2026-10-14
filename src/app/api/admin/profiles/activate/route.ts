import { canAdmin, sameOrigin, sessionUser } from "@/lib/admin";
import {
  activateDirectoryProfile, availableDirectoryProfiles, storedDirectoryProfileDefinition,
} from "@/lib/directory-profiles";
import type { ProfileMigrationPlan } from "@/lib/directory-profile-types";
import { requestJson, requestJsonErrorResponse } from "@/lib/request-json";

type Input = {
  profileId?: unknown;
  version?: unknown;
  expectedRevision?: unknown;
  migration?: unknown;
};

export async function POST(request: Request) {
  const user = await sessionUser(request.headers);
  if (!user || !canAdmin(user.role)) return Response.json({ error: "Forbidden" }, { status: 403 });
  if (!sameOrigin(request)) return Response.json({ error: "Invalid origin" }, { status: 403 });
  let raw: unknown;
  try { raw = await requestJson(request, 256 * 1024); }
  catch (error) { return requestJsonErrorResponse(error); }
  const input = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Input : {};
  if (typeof input.profileId !== "string" || typeof input.version !== "string" ||
      !Number.isSafeInteger(input.expectedRevision)) {
    return Response.json({ error: "Profile, version, and revision are required" }, { status: 400 });
  }
  try {
    const profile = availableDirectoryProfiles().find((candidate) =>
      candidate.profileId === input.profileId && candidate.version === input.version);
    if (!profile) throw new Error("Stored directory profile is missing");
    const definition = storedDirectoryProfileDefinition(input.profileId, input.version);
    const state = activateDirectoryProfile({ definition, sourceKind: profile.sourceKind,
      sourceId: profile.sourceId ?? undefined, expectedRevision: input.expectedRevision as number,
      migration: input.migration as ProfileMigrationPlan | undefined, actorUserId: user.id });
    return Response.json({ state });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Activation failed" },
      { status: 400 });
  }
}
