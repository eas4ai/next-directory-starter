import { Resend } from "resend";
import { recordAudit } from "@/lib/audit";

export type AccountEmailKind = "verification" | "reset" | "magic";

export function accountMailConfigured(): boolean {
  const key = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_FROM?.trim();
  if (!key || !from || !/^[^<>\s@]+@[^<>\s@]+\.[^<>\s@]+$/.test(
    from.match(/<([^<>]+)>/)?.[1] ?? from,
  )) return false;
  const override = process.env.RESEND_API_BASE_URL;
  if (!override) return true;
  try { return ["127.0.0.1", "localhost", "::1"].includes(new URL(override).hostname); }
  catch { return false; }
}

export async function sendAccountEmail(
  to: string, subject: string, text: string, kind: AccountEmailKind,
): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  try {
    if (!accountMailConfigured() || !key || !from) {
      throw new Error("RESEND_API_KEY and RESEND_FROM must identify a valid sender.");
    }
    // The loopback override lets the account mechanism exercise the real SDK without external mail.
    const override = process.env.RESEND_API_BASE_URL;
    const resend = new Resend(key, override ? { baseUrl: override } : undefined);
    const { error } = await resend.emails.send({ from, to: [to], subject, text });
    if (error) throw new Error("Resend rejected account email delivery.");
  } catch (error) {
    try { recordAudit("account.email_delivery_failed", "system", `${kind}:${to.toLowerCase()}`); }
    catch { console.error("Account email failure could not be recorded in audit history."); }
    throw error;
  }
}
