import { createHash } from "node:crypto";
import { database } from "@/lib/database";
import { migrateCatalog } from "@/lib/catalog-migrations";

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function recordVerificationLinkUse(token: string): void {
  migrateCatalog();
  database.prepare(`INSERT OR IGNORE INTO email_verification_uses (token_hash, used_at)
    VALUES (?, ?)`).run(tokenHash(token), new Date().toISOString());
}

export function verificationLinkWasUsed(token: string): boolean {
  migrateCatalog();
  return Boolean(database.prepare("SELECT 1 FROM email_verification_uses WHERE token_hash = ?")
    .get(tokenHash(token)));
}
