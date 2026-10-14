import { adminReadResponse } from "@/lib/admin-api";
import {
  activeDirectoryProfiles, availableDirectoryProfiles, directoryProfileState,
} from "@/lib/directory-profiles";

export async function GET(request: Request) {
  return adminReadResponse(request, () => ({
    state: directoryProfileState(),
    profiles: availableDirectoryProfiles(),
    active: activeDirectoryProfiles().definitions,
  }));
}
