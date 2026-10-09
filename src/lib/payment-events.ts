import type Stripe from "stripe";
import { database } from "@/lib/database";
import { migrateCatalog } from "@/lib/catalog-migrations";
import { HttpError, httpErrorResponse } from "@/lib/http-error";

migrateCatalog();

export class PaymentEventError extends HttpError {}
export const paymentEventErrorResponse = httpErrorResponse;

type PurchaseRow = {
  id: string;
  listing_slug: string;
  amount_minor: number;
  currency: string;
  duration_days: number;
  featured: number;
  stripe_session_id: string;
  stripe_payment_intent_id: string | null;
  status: "pending" | "paid" | "refunded";
};

function eventObject(event: Stripe.Event): Record<string, unknown> {
  const value = event.data?.object;
  if (!value || typeof value !== "object") throw new PaymentEventError(400, "Invalid Stripe event");
  return value as unknown as Record<string, unknown>;
}

function settle(event: Stripe.Event): void {
  const session = eventObject(event);
  const id = session.client_reference_id;
  if (typeof id !== "string") throw new PaymentEventError(400, "Missing purchase reference");
  const purchase = database.prepare("SELECT * FROM purchases WHERE id = ?")
    .get(id) as PurchaseRow | undefined;
  if (!purchase || session.id !== purchase.stripe_session_id ||
      session.object !== "checkout.session" || session.mode !== "payment" ||
      session.amount_total !== purchase.amount_minor || session.currency !== purchase.currency) {
    throw new PaymentEventError(409, "Checkout does not match the pending purchase");
  }
  if (event.type === "checkout.session.completed" && session.payment_status === "unpaid") return;
  if (session.payment_status !== "paid" || typeof session.payment_intent !== "string" ||
      (purchase.stripe_payment_intent_id && purchase.stripe_payment_intent_id !== session.payment_intent)) {
    throw new PaymentEventError(409, "Checkout payment is not complete or does not match");
  }
  if (purchase.status === "paid" || purchase.status === "refunded") return;
  const startsAt = new Date();
  const endsAt = new Date(startsAt.getTime() + purchase.duration_days * 86_400_000);
  database.prepare(`UPDATE purchases SET status = 'paid', stripe_payment_intent_id = ?
    WHERE id = ? AND status = 'pending'`).run(session.payment_intent, id);
  database.prepare(`INSERT INTO entitlements
    (purchase_id, listing_slug, starts_at, ends_at, featured, revoked_at)
    VALUES (?, ?, ?, ?, ?, NULL)`).run(
    id, purchase.listing_slug, startsAt.toISOString(), endsAt.toISOString(), purchase.featured,
  );
}

function refund(event: Stripe.Event): void {
  const charge = eventObject(event);
  if (charge.object !== "charge" || typeof charge.payment_intent !== "string" ||
      typeof charge.amount !== "number" || typeof charge.amount_refunded !== "number") {
    throw new PaymentEventError(400, "Invalid refund event");
  }
  if (charge.refunded !== true || charge.amount_refunded < charge.amount) return;
  const purchase = database.prepare("SELECT * FROM purchases WHERE stripe_payment_intent_id = ?")
    .get(charge.payment_intent) as PurchaseRow | undefined;
  if (!purchase) throw new PaymentEventError(409, "Refund has no matching purchase");
  if (purchase.status === "refunded") return;
  const now = new Date().toISOString();
  database.prepare("UPDATE purchases SET status = 'refunded' WHERE id = ? AND status = 'paid'").run(purchase.id);
  database.prepare("UPDATE entitlements SET revoked_at = ? WHERE purchase_id = ? AND revoked_at IS NULL")
    .run(now, purchase.id);
}

export function processStripeEvent(event: Stripe.Event): void {
  if (!event.id || typeof event.id !== "string" || !event.type || typeof event.type !== "string") {
    throw new PaymentEventError(400, "Invalid Stripe event envelope");
  }
  database.transaction(() => {
    const inserted = database.prepare(`INSERT INTO stripe_events (id, type, received_at)
      VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING`).run(event.id, event.type, new Date().toISOString());
    if (inserted.changes === 0) return;
    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
      settle(event);
    } else if (event.type === "charge.refunded") {
      refund(event);
    }
  }).immediate();
}
