import Stripe from "stripe";
import { paymentEventErrorResponse, processStripeEvent } from "@/lib/payment-events";
import { billingProfileErrorResponse, stripeWebhookCandidates } from "@/lib/billing-profiles";
import { database } from "@/lib/database";
import { PaymentLifecycleError, paymentLifecycleErrorResponse, retainVerifiedEvidence } from "@/lib/payment-lifecycle";
import { stripeEffect } from "@/lib/payment-normalizers";

function verifiedEvent(body: string, signature: string,
  candidates: ReturnType<typeof stripeWebhookCandidates>):
  { event: Stripe.Event; mode: "test" | "live" } | null {
  const verifier = new Stripe("sk_test_webhook_verification_only");
  for (const candidate of candidates) {
    try {
      const event = verifier.webhooks.constructEvent(body, signature, candidate.secret);
      if ((candidate.profile && typeof event.livemode !== "boolean") ||
          (typeof event.livemode === "boolean" &&
            event.livemode !== (candidate.mode === "live"))) continue;
      return { event, mode: candidate.mode };
    } catch (error) {
      if (!(error instanceof Stripe.errors.StripeSignatureVerificationError)) throw error;
    }
  }
  return null;
}

function hostedPurchase(event: Stripe.Event): boolean {
  const data = event.data?.object as unknown as Record<string, unknown> | undefined;
  const metadata = data?.metadata && typeof data.metadata === "object"
    ? data.metadata as Record<string, unknown> : undefined;
  const parent = data?.parent && typeof data.parent === "object"
    ? data.parent as Record<string, unknown> : undefined;
  const details = parent?.subscription_details && typeof parent.subscription_details === "object"
    ? parent.subscription_details as Record<string, unknown> : undefined;
  const subscriptionMetadata = details?.metadata && typeof details.metadata === "object"
    ? details.metadata as Record<string, unknown> : undefined;
  const purchaseId = typeof data?.client_reference_id === "string"
    ? data.client_reference_id : typeof metadata?.purchaseId === "string"
      ? metadata.purchaseId : typeof subscriptionMetadata?.purchaseId === "string"
        ? subscriptionMetadata.purchaseId : null;
  const subscriptionId = typeof data?.subscription === "string"
    ? data.subscription : null;
  if (purchaseId) {
    return Boolean(database.prepare(`SELECT id FROM purchases WHERE id = ?
      AND provider = 'stripe' AND provider_resource_id IS NOT NULL`).get(purchaseId));
  }
  if (subscriptionId) {
    return Boolean(database.prepare(`SELECT id FROM purchases WHERE provider = 'stripe'
      AND provider_subscription_id = ?`).get(subscriptionId));
  }
  return false;
}

export async function POST(request: Request) {
  let candidates;
  try { candidates = stripeWebhookCandidates(); }
  catch (error) { return billingProfileErrorResponse(error); }
  if (!candidates.length) return Response.json({ error: "Stripe webhook is not configured" }, { status: 503 });
  const signature = request.headers.get("stripe-signature");
  if (!signature) return Response.json({ error: "Missing Stripe signature" }, { status: 400 });
  const body = await request.text();
  if (body.length > 1_000_000) return Response.json({ error: "Webhook is too large" }, { status: 413 });
  const verified = verifiedEvent(body, signature, candidates);
  if (!verified) return Response.json({ error: "Invalid Stripe signature or mode" }, { status: 400 });
  try {
    if (hostedPurchase(verified.event)) {
      const result = retainVerifiedEvidence({ provider: "stripe", mode: verified.mode,
        eventId: verified.event.id, eventType: verified.event.type,
        raw: verified.event, effect: stripeEffect(verified.event) });
      return Response.json({ received: true, processed: result.processed },
        { status: result.processed ? 200 : 202 });
    }
    processStripeEvent(verified.event);
  } catch (error) {
    return error instanceof PaymentLifecycleError
      ? paymentLifecycleErrorResponse(error) : paymentEventErrorResponse(error);
  }
  return Response.json({ received: true });
}
