import { adminReadResponse } from "@/lib/admin-api";
import { recentAuditEvents } from "@/lib/audit";

export async function GET(request: Request) {
  return adminReadResponse(request, () => ({ events: recentAuditEvents() }));
}
