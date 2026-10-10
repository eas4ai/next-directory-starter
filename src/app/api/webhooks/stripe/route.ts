import Stripe from "stripe";
import { paymentEventErrorResponse, processStripeEvent } from "@/lib/payment-events";
import { billingProfileErrorResponse, stripeWebhookCandidates } from "@/lib/billing-profiles";

function verifiedEvent(body: string, signature: string,
  candidates: ReturnType<typeof stripeWebhookCandidates>): Stripe.Event | null {
  const verifier = new Stripe("sk_test_webhook_verification_only");
  for (const candidate of candidates) {
    try {
      const event = verifier.webhooks.constructEvent(body, signature, candidate.secret);
      if ((candidate.profile && typeof event.livemode !== "boolean") ||
          (typeof event.livemode === "boolean" &&
            event.livemode !== (candidate.mode === "live"))) continue;
      return event;
    } catch (error) {
      if (!(error instanceof Stripe.errors.StripeSignatureVerificationError)) throw error;
    }
  }
  return null;
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
  const event = verifiedEvent(body, signature, candidates);
  if (!event) return Response.json({ error: "Invalid Stripe signature or mode" }, { status: 400 });
  try {
    processStripeEvent(event);
  } catch (error) {
    return paymentEventErrorResponse(error);
  }
  return Response.json({ received: true });
}
