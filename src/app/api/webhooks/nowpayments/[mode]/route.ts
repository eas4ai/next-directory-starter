import { billingProfileErrorResponse, providerWebhookSecret, type BillingMode } from "@/lib/billing-profiles";
import { paymentLifecycleErrorResponse, retainVerifiedEvidence } from "@/lib/payment-lifecycle";
import { nowPaymentsEffect } from "@/lib/payment-normalizers";

export async function POST(request: Request, context: { params: Promise<{ mode: string }> }) {
  const { mode } = await context.params;
  if (mode !== "test" && mode !== "live") return new Response(null, { status: 404 });
  const signature = request.headers.get("x-nowpayments-sig");
  if (!signature) return Response.json({ error: "Missing NOWPayments signature" }, { status: 400 });
  let secret: string | null;
  try { secret = providerWebhookSecret("nowpayments", mode as BillingMode); }
  catch (error) { return billingProfileErrorResponse(error); }
  if (!secret) return Response.json({ error: "NOWPayments webhook is not configured" }, { status: 503 });
  const body = await request.text();
  if (body.length > 1_000_000) return Response.json({ error: "Webhook is too large" }, { status: 413 });
  try {
    const payload = JSON.parse(body) as Record<string, unknown>;
    const { NowPaymentsSDK } = await import("@nowpaymentsio/nowpayments-sdk-nodejs");
    const sdk = new NowPaymentsSDK({ ipnSecret: secret });
    const event = sdk.parseWebhook(payload, signature);
    const payment = event.type === "payment.status_changed" ? event.payment : null;
    const eventId = payment?.payment_id && payment?.payment_status
      ? `${payment.payment_id}:${payment.payment_status}` : "unknown";
    const result = retainVerifiedEvidence({ provider: "nowpayments", mode,
      eventId, eventType: event.type, raw: payload,
      effect: payment ? nowPaymentsEffect(payment) : { kind: "noop" } });
    return Response.json({ received: true, processed: result.processed },
      { status: result.processed ? 200 : 202 });
  } catch (error) {
    if (error instanceof SyntaxError ||
        (error instanceof Error && error.message.includes("signature"))) {
      return Response.json({ error: "Invalid NOWPayments signature or payload" }, { status: 400 });
    }
    return paymentLifecycleErrorResponse(error);
  }
}
