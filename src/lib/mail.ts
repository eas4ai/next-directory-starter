import { Resend } from "resend";

export async function sendAccountEmail(to: string, subject: string, text: string): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  if (!key || !from) throw new Error("RESEND_API_KEY and RESEND_FROM must be configured for account email.");

  // The loopback override lets the account mechanism exercise the real SDK without external mail.
  const override = process.env.RESEND_API_BASE_URL;
  if (override && !["127.0.0.1", "localhost", "::1"].includes(new URL(override).hostname)) {
    throw new Error("RESEND_API_BASE_URL only accepts a local test server.");
  }
  const resend = new Resend(key, override ? { baseUrl: override } : undefined);
  const { error } = await resend.emails.send({ from, to: [to], subject, text });
  if (error) throw new Error("Account email delivery failed.");
}
