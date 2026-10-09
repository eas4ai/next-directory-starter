import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { database } from "@/lib/database";
import { migrateCatalog } from "@/lib/catalog-migrations";
import { HttpError, httpErrorResponse } from "@/lib/http-error";
import { planByKey } from "@/lib/plans";
import { publicUrl } from "@/lib/page-metadata";

migrateCatalog();

export class CheckoutError extends HttpError {}
export const checkoutErrorResponse = httpErrorResponse;

export type CreateStripeSession = (
  params: Stripe.Checkout.SessionCreateParams,
  options: { idempotencyKey: string },
) => Promise<Pick<Stripe.Checkout.Session, "id" | "url">>;

type ReservedPurchase = {
  id: string;
  listing_slug: string;
  owner_user_id: string;
  plan_key: string;
  amount_minor: number;
  currency: string;
  duration_days: number;
  featured: number;
  stripe_session_id: string;
  stripe_product_name: string;
  status: "pending" | "paid" | "refunded";
  created_at: string;
};

function reservePurchase(ownerUserId: string, listingSlug: string, planKey: string, requestId: string): ReservedPurchase {
  return database.transaction(() => {
    const listing = database.prepare("SELECT slug, name, status FROM listings WHERE slug = ? AND owner_user_id = ?")
      .get(listingSlug, ownerUserId) as { slug: string; name: string; status: string } | undefined;
    if (!listing || listing.status !== "published") {
      throw new CheckoutError(404, "Approved owned listing not found");
    }
    const existing = database.prepare("SELECT * FROM purchases WHERE owner_user_id = ? AND checkout_request_id = ?")
      .get(ownerUserId, requestId) as ReservedPurchase | undefined;
    if (existing) {
      if (existing.listing_slug !== listingSlug || existing.plan_key !== planKey || existing.status !== "pending") {
        throw new CheckoutError(409, "Checkout request was already used");
      }
      return existing;
    }
    const plan = planByKey(planKey);
    if (!plan || !plan.enabled) throw new CheckoutError(404, "Available plan not found");
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    database.prepare(`INSERT INTO purchases
      (id, listing_slug, owner_user_id, plan_key, amount_minor, currency, duration_days,
        featured, stripe_session_id, stripe_product_name, checkout_request_id, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`).run(
      id, listingSlug, ownerUserId, plan.key, plan.amountMinor, plan.currency,
      plan.durationDays, Number(plan.featured), `pending:${id}`,
      `${plan.name} · ${listing.name}`, requestId, createdAt,
    );
    return database.prepare("SELECT * FROM purchases WHERE id = ?").get(id) as ReservedPurchase;
  }).immediate();
}

export async function createPublishingCheckout(
  ownerUserId: string,
  listingSlug: string,
  planKey: string,
  requestId: string,
  createSession: CreateStripeSession,
): Promise<{ purchaseId: string; url: string }> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)) {
    throw new CheckoutError(400, "Invalid checkout request ID");
  }
  const purchase = reservePurchase(ownerUserId, listingSlug, planKey, requestId);
  const expiresAt = Math.floor(Date.parse(purchase.created_at) / 1000) + 3600;
  if (expiresAt <= Math.floor(Date.now() / 1000) + 60) {
    throw new CheckoutError(409, "Checkout request expired. Refresh the page and try again");
  }
  const session = await createSession({
    mode: "payment",
    client_reference_id: purchase.id,
    expires_at: expiresAt,
    success_url: publicUrl(`/owner/listings/${encodeURIComponent(listingSlug)}/plans?checkout=return`),
    cancel_url: publicUrl(`/owner/listings/${encodeURIComponent(listingSlug)}/plans?checkout=cancel`),
    line_items: [{
      quantity: 1,
      price_data: {
        currency: purchase.currency,
        unit_amount: purchase.amount_minor,
        product_data: { name: purchase.stripe_product_name, description: `${purchase.duration_days} days of ${purchase.featured ? "featured" : "standard"} placement` },
      },
    }],
    metadata: { purchaseId: purchase.id, listingSlug, ownerUserId, planKey },
    payment_intent_data: { metadata: { purchaseId: purchase.id, listingSlug } },
  }, { idempotencyKey: purchase.id });
  if (!session.id || !session.url) throw new CheckoutError(502, "Stripe did not provide a checkout URL");
  const checkoutUrl = new URL(session.url);
  if (checkoutUrl.protocol !== "https:" || checkoutUrl.hostname !== "checkout.stripe.com") {
    throw new CheckoutError(502, "Stripe returned an invalid checkout URL");
  }
  database.transaction(() => {
    const current = database.prepare("SELECT stripe_session_id FROM purchases WHERE id = ? AND status = 'pending'")
      .get(purchase.id) as { stripe_session_id: string } | undefined;
    if (!current || (current.stripe_session_id !== `pending:${purchase.id}` && current.stripe_session_id !== session.id)) {
      throw new CheckoutError(409, "Checkout request changed while starting payment");
    }
    database.prepare("UPDATE purchases SET stripe_session_id = ? WHERE id = ? AND status = 'pending'")
      .run(session.id, purchase.id);
  }).immediate();
  return { purchaseId: purchase.id, url: session.url };
}
