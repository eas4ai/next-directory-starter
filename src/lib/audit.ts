import { randomUUID } from "node:crypto";
import { database } from "@/lib/database";
import { migrateCatalog } from "@/lib/catalog-migrations";

migrateCatalog();

export type AuditEvent = {
  id: string;
  action: string;
  actorUserId: string;
  target: string;
  occurredAt: string;
};

export function recordAudit(action: string, actorUserId: string, target: string): void {
  if (!action || !actorUserId || !target) throw new Error("Audit event requires an action, actor and target.");
  database.prepare(`INSERT INTO audit_events (id, action, actor_user_id, target, occurred_at)
    VALUES (?, ?, ?, ?, ?)`).run(randomUUID(), action, actorUserId, target, new Date().toISOString());
}

export function recentAuditEvents(limit = 100): AuditEvent[] {
  const rows = database.prepare(`SELECT id, action, actor_user_id, target, occurred_at
    FROM audit_events ORDER BY occurred_at DESC, id DESC LIMIT ?`).all(Math.min(Math.max(1, limit), 100)) as {
    id: string; action: string; actor_user_id: string; target: string; occurred_at: string;
  }[];
  return rows.map((row) => ({
    id: row.id, action: row.action, actorUserId: row.actor_user_id,
    target: row.target, occurredAt: row.occurred_at,
  }));
}
