import { Paddle } from "@paddle/paddle-node-sdk";
import { billingProfileErrorResponse, providerWebhookSecret, type BillingMode } from "@/lib/billing-profiles";
import { paymentLifecycleErrorResponse, retainVerifiedEvidence } from "@/lib/payment-lifecycle";
import { paddleEffect } from "@/lib/payment-normalizers";

export async function POST(request: Request, context: { params: Promise<{ mode: string }> }) {
  const { mode } = await context.params;
  if (mode !== "test" && mode !== "live") return new Response(null, { status: 404 });
  const signature = request.headers.get("paddle-signature");
  if (!signature) return Response.json({ error: "Missing Paddle signature" }, { status: 400 });
  let secret: string | null;
  try { secret = providerWebhookSecret("paddle", mode as BillingMode); }
  catch (error) { return billingProfileErrorResponse(error); }
  if (!secret) return Response.json({ error: "Paddle webhook is not configured" }, { status: 503 });
  const body = await request.text();
  if (body.length > 1_000_000) return Response.json({ error: "Webhook is too large" }, { status: 413 });
  const paddle = new Paddle("webhook_verification_only");
  let verified = false;
  try { verified = await paddle.webhooks.isSignatureValid(body, secret, signature); }
  catch { /* malformed signature */ }
  if (!verified) return Response.json({ error: "Invalid Paddle signature" }, { status: 400 });
  try {
    const payload = JSON.parse(body) as Record<string, unknown>;
    if (typeof payload.event_id !== "string" || typeof payload.event_type !== "string") {
      return Response.json({ error: "Invalid Paddle event envelope" }, { status: 400 });
    }
    const result = retainVerifiedEvidence({ provider: "paddle", mode,
      eventId: payload.event_id, eventType: payload.event_type,
      raw: payload, effect: paddleEffect(payload) });
    return Response.json({ received: true, processed: result.processed },
      { status: result.processed ? 200 : 202 });
  } catch (error) { return paymentLifecycleErrorResponse(error); }
}
