import Stripe from "stripe";
import { paymentEventErrorResponse, processStripeEvent } from "@/lib/payment-events";

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return Response.json({ error: "Stripe webhook is not configured" }, { status: 503 });
  const signature = request.headers.get("stripe-signature");
  if (!signature) return Response.json({ error: "Missing Stripe signature" }, { status: 400 });
  const body = await request.text();
  if (body.length > 1_000_000) return Response.json({ error: "Webhook is too large" }, { status: 413 });
  let event: Stripe.Event;
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "sk_test_webhook_verification_only");
    event = stripe.webhooks.constructEvent(body, signature, secret);
  } catch {
    return Response.json({ error: "Invalid Stripe signature" }, { status: 400 });
  }
  try {
    processStripeEvent(event);
  } catch (error) {
    return paymentEventErrorResponse(error);
  }
  return Response.json({ received: true });
}
