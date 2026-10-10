import { database } from "@/lib/database";
import { recordAudit } from "@/lib/audit";
import { HttpError, httpErrorResponse } from "@/lib/http-error";
import { canonicalAccountRole, hasRole } from "@/lib/staff-roles";

export type ManagedAccount = { id: string; name: string; email: string; role: string | null;
  banned: boolean; emailVerified: boolean };
type AccountRow = Omit<ManagedAccount, "banned" | "emailVerified"> & { banned: number; emailVerified: number };
export class AccountError extends HttpError {}
export const accountErrorResponse = httpErrorResponse;

function managed(row: AccountRow): ManagedAccount {
  return { ...row, banned: Boolean(row.banned), emailVerified: Boolean(row.emailVerified) };
}

function accountRow(id: string): AccountRow {
  const row = database.prepare('SELECT id, name, email, role, banned, emailVerified FROM "user" WHERE id = ?')
    .get(id) as AccountRow | undefined;
  if (!row) throw new AccountError(404, "Account not found");
  return row;
}

function activeAdminCount(): number {
  return (database.prepare(`SELECT COUNT(*) AS count FROM "user"
    WHERE (',' || COALESCE(role, '') || ',') LIKE '%,admin,%'
      AND COALESCE(banned, 0) = 0 AND emailVerified = 1`)
    .get() as { count: number }).count;
}

export function managedAccounts(page = 1): { accounts: ManagedAccount[]; page: number; pages: number } {
  const total = (database.prepare('SELECT COUNT(*) AS count FROM "user"').get() as { count: number }).count;
  const pages = Math.max(1, Math.ceil(total / 50));
  const selected = Math.min(Math.max(1, Number.isFinite(page) ? Math.floor(page) : 1), pages);
  const rows = database.prepare('SELECT id, name, email, role, banned, emailVerified FROM "user" ORDER BY email LIMIT 50 OFFSET ?')
    .all((selected - 1) * 50) as AccountRow[];
  return { accounts: rows.map(managed), page: selected, pages };
}

export function changeAccountRole(actorUserId: string, targetUserId: string, role: unknown): ManagedAccount {
  const selectedRole = canonicalAccountRole(role);
  if (!selectedRole) {
    throw new AccountError(400, "Choose a supported role");
  }
  return database.transaction(() => {
    const current = accountRow(targetUserId);
    if (selectedRole !== "user" && (!current.emailVerified || current.banned)) {
      throw new AccountError(409, "Verify and reinstate the account before granting staff access");
    }
    if (current.role === selectedRole) return managed(current);
    if (!current.banned && current.emailVerified && hasRole(current.role, "admin") && selectedRole !== "admin") {
      if (activeAdminCount() <= 1) throw new AccountError(409, "Keep at least one administrator");
    }
    database.prepare('UPDATE "user" SET role = ? WHERE id = ?').run(selectedRole, targetUserId);
    recordAudit("account.role", actorUserId, targetUserId);
    return { ...managed(current), role: selectedRole };
  }).immediate();
}

export function changeAccountSuspension(
  actorUserId: string, targetUserId: string, suspended: unknown, reason: unknown,
): ManagedAccount {
  if (typeof suspended !== "boolean") throw new AccountError(400, "Choose whether to suspend or reinstate");
  const explanation = typeof reason === "string" ? reason.trim() : "";
  if (suspended && (!explanation || explanation.length > 280)) {
    throw new AccountError(400, "Give a reason of at most 280 characters");
  }
  return database.transaction(() => {
    const current = accountRow(targetUserId);
    if (Boolean(current.banned) === suspended) return managed(current);
    if (suspended && hasRole(current.role, "admin")) {
      if (activeAdminCount() <= 1) throw new AccountError(409, "Keep at least one active administrator");
    }
    database.prepare('UPDATE "user" SET banned = ?, banReason = ?, banExpires = NULL WHERE id = ?')
      .run(suspended ? 1 : 0, suspended ? explanation : null, targetUserId);
    if (suspended) database.prepare('DELETE FROM session WHERE userId = ?').run(targetUserId);
    recordAudit(suspended ? "account.suspend" : "account.reinstate", actorUserId, targetUserId);
    return { ...managed(current), banned: suspended };
  }).immediate();
}
