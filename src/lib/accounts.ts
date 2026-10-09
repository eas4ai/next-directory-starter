import { database } from "@/lib/database";
import { recordAudit } from "@/lib/audit";
import { HttpError, httpErrorResponse } from "@/lib/http-error";

export type ManagedAccount = { id: string; name: string; email: string; role: string | null };
export class AccountError extends HttpError {}
export const accountErrorResponse = httpErrorResponse;

export function managedAccounts(page = 1): { accounts: ManagedAccount[]; page: number; pages: number } {
  const total = (database.prepare('SELECT COUNT(*) AS count FROM "user"').get() as { count: number }).count;
  const pages = Math.max(1, Math.ceil(total / 50));
  const selected = Math.min(Math.max(1, Number.isFinite(page) ? Math.floor(page) : 1), pages);
  const accounts = database.prepare('SELECT id, name, email, role FROM "user" ORDER BY email LIMIT 50 OFFSET ?')
    .all((selected - 1) * 50) as ManagedAccount[];
  return { accounts, page: selected, pages };
}

export function changeAccountRole(actorUserId: string, targetUserId: string, role: unknown): ManagedAccount {
  if (typeof role !== "string" || !["user", "moderator", "editor", "admin"].includes(role)) {
    throw new AccountError(400, "Choose a supported role");
  }
  return database.transaction(() => {
    const current = database.prepare('SELECT id, name, email, role FROM "user" WHERE id = ?')
      .get(targetUserId) as ManagedAccount | undefined;
    if (!current) throw new AccountError(404, "Account not found");
    if (current.role === role) return current;
    if (current.role?.split(",").includes("admin") && role !== "admin") {
      const admins = (database.prepare(`SELECT COUNT(*) AS count FROM "user"
        WHERE (',' || COALESCE(role, '') || ',') LIKE '%,admin,%'`).get() as { count: number }).count;
      if (admins <= 1) throw new AccountError(409, "Keep at least one administrator");
    }
    database.prepare('UPDATE "user" SET role = ? WHERE id = ?').run(role, targetUserId);
    recordAudit("account.role", actorUserId, targetUserId);
    return { ...current, role };
  }).immediate();
}
