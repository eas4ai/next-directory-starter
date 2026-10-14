import { createHash, randomBytes, randomUUID } from "node:crypto";
import { canManageCatalog } from "@/lib/admin";
import { migrateCatalog } from "@/lib/catalog-migrations";
import { database } from "@/lib/database";

migrateCatalog();

export type AgentKeyScope = "stage" | "publish";
type KeyRow = { id: string; user_id: string; expires_at: string; scope: AgentKeyScope };
type AccountRow = { role: string | null; emailVerified: number; banned: number | null };
export type AgentKeySummary = { id: string; name: string; expiresAt: string;
  revokedAt: string | null; createdAt: string; scope: AgentKeyScope };

function hashToken(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export function issueAgentKey(userId: string, name: unknown, expiresInDays: unknown,
  requestedScope: unknown = "stage") {
  const scope = requestedScope === "stage" || requestedScope === "publish" ? requestedScope : null;
  if (typeof name !== "string" || !name.trim() || name.length > 80 ||
      !Number.isInteger(expiresInDays) || Number(expiresInDays) < 1 || Number(expiresInDays) > 90 ||
      !scope) {
    throw new Error("Use a name, an expiry from 1 to 90 days, and a valid access scope.");
  }
  const id = randomUUID();
  const secret = `dir_${randomBytes(32).toString("base64url")}`;
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + Number(expiresInDays) * 86_400_000).toISOString();
  database.prepare(`INSERT INTO agent_keys
    (id, user_id, name, token_hash, expires_at, revoked_at, created_at, scope)
    VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`).run(
    id, userId, name.trim(), hashToken(secret), expiresAt, createdAt, scope,
  );
  return { id, name: name.trim(), secret, createdAt, expiresAt, scope };
}

export function listAgentKeys(userId: string): AgentKeySummary[] {
  return database.prepare(`SELECT id, name, expires_at AS expiresAt,
      revoked_at AS revokedAt, created_at AS createdAt, scope
    FROM agent_keys WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`)
    .all(userId) as AgentKeySummary[];
}

export function revokeAgentKey(userId: string, id: string): boolean {
  return database.prepare(`UPDATE agent_keys SET revoked_at = ?
    WHERE id = ? AND user_id = ? AND revoked_at IS NULL`)
    .run(new Date().toISOString(), id, userId).changes > 0;
}

export function agentPrincipal(header: string | null) {
  const secret = /^Bearer (dir_[A-Za-z0-9_-]{40,100})$/.exec(header ?? "")?.[1];
  if (!secret) return null;
  const key = database.prepare(`SELECT id, user_id, expires_at, scope FROM agent_keys
    WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?`)
    .get(hashToken(secret), new Date().toISOString()) as KeyRow | undefined;
  if (!key) return null;
  const account = database.prepare(`SELECT role, emailVerified, banned FROM "user" WHERE id = ?`)
    .get(key.user_id) as AccountRow | undefined;
  if (!account?.emailVerified || account.banned || !canManageCatalog(account.role)) return null;
  return { userId: key.user_id, keyId: key.id, expiresAt: key.expires_at, scope: key.scope };
}
