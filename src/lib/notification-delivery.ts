import { randomUUID } from "node:crypto";
import { Resend } from "resend";
import { database } from "@/lib/database";
import { migrateCatalog } from "@/lib/catalog-migrations";
import { accountMailConfigured } from "@/lib/mail";

migrateCatalog();

const MAX_ATTEMPTS = 6;
const CLAIM_MS = 15 * 60_000;
const IDEMPOTENCY_MS = 24 * 60 * 60_000;

type DeliveryRow = {
  id: string; owner_user_id: string; subject: string; body: string;
  email_attempts: number; email_to: string | null; email_from: string | null;
};

type Claimed = {
  id: string; token: string; subject: string; body: string;
  to: string; from: string; attempts: number;
};

export type NotificationSend = (payload: {
  to: string; from: string; subject: string; text: string; idempotencyKey: string;
}) => Promise<string>;

const sendWithResend: NotificationSend = async ({ to, from, subject, text, idempotencyKey }) => {
  if (!accountMailConfigured() || !process.env.RESEND_API_KEY) {
    throw new Error("Resend sender is unavailable");
  }
  const override = process.env.RESEND_API_BASE_URL;
  const resend = new Resend(process.env.RESEND_API_KEY,
    override ? { baseUrl: override } : undefined);
  const { data, error } = await resend.emails.send({ from, to: [to], subject, text },
    { idempotencyKey });
  if (error || !data?.id) throw new Error("Resend did not acknowledge the notification");
  return data.id;
};

function claimNext(now: Date, injectedSender: boolean): Claimed | null {
  const iso = now.toISOString();
  const expired = new Date(now.getTime() - IDEMPOTENCY_MS).toISOString();
  return database.transaction(() => {
    database.prepare(`UPDATE owner_notifications SET email_state = 'failed',
      email_next_attempt_at = NULL, email_claim_token = NULL, email_claimed_until = NULL,
      email_last_error = 'Delivery outcome unknown; inspect Resend before retrying'
      WHERE email_state = 'sending' AND email_claimed_until <= ?
        AND email_first_attempt_at <= ?`).run(iso, expired);
    database.prepare(`UPDATE owner_notifications SET email_next_attempt_at = NULL,
      email_last_error = 'Delivery outcome unknown; inspect Resend before retrying'
      WHERE email_state = 'failed' AND email_next_attempt_at IS NOT NULL
        AND email_first_attempt_at <= ?`).run(expired);
    const row = database.prepare(`SELECT id, owner_user_id, subject, body, email_attempts,
      email_to, email_from FROM owner_notifications
      WHERE email_attempts < ? AND (
        email_state = 'pending' OR
        (email_state = 'failed' AND email_next_attempt_at IS NOT NULL
          AND email_next_attempt_at <= ?) OR
        (email_state = 'sending' AND email_claimed_until <= ?
          AND email_first_attempt_at > ?))
      ORDER BY created_at, id LIMIT 1`)
      .get(MAX_ATTEMPTS, iso, iso, expired) as DeliveryRow | undefined;
    if (!row) return null;
    const user = database.prepare('SELECT email FROM "user" WHERE id = ?')
      .get(row.owner_user_id) as { email: string } | undefined;
    const to = row.email_to ?? user?.email ?? "";
    const from = row.email_from || process.env.RESEND_FROM?.trim() ||
      (injectedSender ? "Directory <updates@example.invalid>" : "");
    const token = randomUUID();
    database.prepare(`UPDATE owner_notifications SET email_state = 'sending',
      email_attempts = email_attempts + 1, email_claimed_until = ?, email_claim_token = ?,
      email_first_attempt_at = COALESCE(email_first_attempt_at, ?),
      email_to = COALESCE(email_to, NULLIF(?, '')),
      email_from = COALESCE(email_from, NULLIF(?, '')),
      email_last_error = NULL WHERE id = ?`).run(
      new Date(now.getTime() + CLAIM_MS).toISOString(), token, iso, to, from, row.id,
    );
    return { id: row.id, token, subject: row.subject, body: row.body,
      to, from, attempts: row.email_attempts + 1 };
  }).immediate();
}

function markSent(claim: Claimed, providerId: string, now: Date): boolean {
  const updated = database.prepare(`UPDATE owner_notifications SET email_state = 'sent',
    email_sent_at = ?, email_provider_id = ?, email_next_attempt_at = NULL,
    email_claimed_until = NULL, email_claim_token = NULL, email_last_error = NULL
    WHERE id = ? AND email_state = 'sending' AND email_claim_token = ?`)
    .run(now.toISOString(), providerId, claim.id, claim.token);
  return updated.changes === 1;
}

function markFailed(claim: Claimed, now: Date): void {
  const minutes = [1, 5, 15, 60][Math.min(claim.attempts - 1, 3)];
  const next = claim.attempts < MAX_ATTEMPTS
    ? new Date(now.getTime() + minutes * 60_000).toISOString() : null;
  database.prepare(`UPDATE owner_notifications SET email_state = 'failed',
    email_next_attempt_at = ?, email_claimed_until = NULL, email_claim_token = NULL,
    email_last_error = 'Resend delivery failed'
    WHERE id = ? AND email_state = 'sending' AND email_claim_token = ?`)
    .run(next, claim.id, claim.token);
}

export async function deliverOwnerNotifications(options: {
  limit?: number; now?: Date; send?: NotificationSend;
} = {}): Promise<{ attempted: number; sent: number; failed: number }> {
  const limit = options.limit ?? 10;
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("Invalid notification batch limit");
  const send = options.send ?? sendWithResend;
  const summary = { attempted: 0, sent: 0, failed: 0 };
  for (let index = 0; index < Math.min(limit, 50); index += 1) {
    const now = options.now ?? new Date();
    const claim = claimNext(now, Boolean(options.send));
    if (!claim) break;
    summary.attempted += 1;
    try {
      if (!claim.to || !claim.from) throw new Error("Notification recipient or sender unavailable");
      const providerId = await send({ to: claim.to, from: claim.from,
        subject: claim.subject, text: claim.body,
        idempotencyKey: `owner-notification/${claim.id}` });
      if (!providerId) throw new Error("No provider acknowledgement");
      if (markSent(claim, providerId, options.now ?? new Date())) summary.sent += 1;
      else summary.failed += 1;
    } catch {
      markFailed(claim, options.now ?? new Date());
      summary.failed += 1;
    }
  }
  return summary;
}

export function retryOwnerNotification(id: string): boolean {
  const result = database.prepare(`UPDATE owner_notifications SET email_state = 'pending',
    email_attempts = 0, email_next_attempt_at = NULL, email_claimed_until = NULL,
    email_claim_token = NULL, email_first_attempt_at = NULL, email_last_error = NULL
    WHERE id = ? AND email_state = 'failed' AND email_next_attempt_at IS NULL`).run(id);
  return result.changes === 1;
}

export type NotificationDeliveryRow = {
  id: string; subject: string; createdAt: string;
  emailState: string; emailAttempts: number; emailNextAttemptAt: string | null;
  emailLastError: string | null; emailSentAt: string | null;
};

export function notificationDeliveryRows(limit = 100): NotificationDeliveryRow[] {
  const bounded = Math.min(Math.max(Math.floor(limit) || 1, 1), 100);
  const rows = database.prepare(`SELECT id, subject, created_at, email_state,
    email_attempts, email_next_attempt_at, email_last_error, email_sent_at
    FROM owner_notifications ORDER BY CASE WHEN email_state = 'failed' THEN 0 ELSE 1 END,
      created_at DESC, id DESC LIMIT ?`)
    .all(bounded) as {
    id: string; subject: string; created_at: string; email_state: string;
    email_attempts: number; email_next_attempt_at: string | null;
    email_last_error: string | null; email_sent_at: string | null;
  }[];
  return rows.map((row) => ({ id: row.id, subject: row.subject, createdAt: row.created_at,
    emailState: row.email_state, emailAttempts: row.email_attempts,
    emailNextAttemptAt: row.email_next_attempt_at,
    emailLastError: row.email_last_error, emailSentAt: row.email_sent_at }));
}
