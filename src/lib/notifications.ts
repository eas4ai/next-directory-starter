import { randomUUID } from "node:crypto";
import { database } from "@/lib/database";
import { migrateCatalog } from "@/lib/catalog-migrations";

migrateCatalog();

export type OwnerNotification = {
  id: string;
  kind: string;
  subject: string;
  body: string;
  createdAt: string;
  emailState: "pending" | "sending" | "sent" | "failed";
};

export function recordOwnerNotification(ownerUserId: string, kind: string,
  sourceKey: string, subject: string, body: string): boolean {
  if (!ownerUserId || ownerUserId.length > 200 || !kind || kind.length > 80 ||
      !sourceKey || sourceKey.length > 240 || !subject || subject.length > 160 ||
      !body || body.length > 2000 || /\u0000/u.test(subject + body)) {
    throw new Error("Invalid owner notification");
  }
  const inserted = database.prepare(`INSERT INTO owner_notifications
    (id, owner_user_id, kind, source_key, subject, body, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(source_key) DO NOTHING`)
    .run(randomUUID(), ownerUserId, kind, sourceKey, subject, body, new Date().toISOString());
  return inserted.changes === 1;
}

export function recordPurchaseNotification(purchaseId: string, kind: string,
  sourceKey: string, subject: string, body: string): boolean {
  const purchase = database.prepare("SELECT owner_user_id, listing_slug FROM purchases WHERE id = ?")
    .get(purchaseId) as { owner_user_id: string; listing_slug: string } | undefined;
  if (!purchase) throw new Error("Notification purchase not found");
  return recordOwnerNotification(purchase.owner_user_id, kind, sourceKey,
    subject, `${body} Listing: ${purchase.listing_slug}.`);
}

export function listOwnerNotifications(ownerUserId: string): OwnerNotification[] {
  const rows = database.prepare(`SELECT id, kind, subject, body, created_at, email_state
    FROM owner_notifications WHERE owner_user_id = ?
    ORDER BY created_at DESC, id DESC LIMIT 20`).all(ownerUserId) as {
    id: string; kind: string; subject: string; body: string;
    created_at: string; email_state: OwnerNotification["emailState"];
  }[];
  return rows.map((row) => ({ id: row.id, kind: row.kind, subject: row.subject,
    body: row.body, createdAt: row.created_at, emailState: row.email_state }));
}
