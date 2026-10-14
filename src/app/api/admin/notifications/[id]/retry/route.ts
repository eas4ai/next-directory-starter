import { adminWriteGuard } from "@/lib/admin-api";
import { sessionUser } from "@/lib/admin";
import { recordAudit } from "@/lib/audit";
import { retryOwnerNotification } from "@/lib/notification-delivery";
import { database } from "@/lib/database";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const denied = await adminWriteGuard(request);
  if (denied) return denied;
  const id = (await params).id;
  const actor = await sessionUser(request.headers);
  if (!actor) return Response.json({ error: "Forbidden" }, { status: 403 });
  const retried = database.transaction(() => {
    if (!retryOwnerNotification(id)) return false;
    recordAudit("notification.retry", actor.id, id);
    return true;
  }).immediate();
  if (!retried) {
    return Response.json({ error: "Notification is not exhausted or already retrying" }, { status: 409 });
  }
  return Response.json({ ok: true });
}
