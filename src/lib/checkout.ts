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

export async function createPublishingCheckout(
  ownerUserId: string,
  listingSlug: string,
  planKey: string,
  createSession: CreateStripeSession,
): Promise<{ purchaseId: string; url: string }> {
  const listing = database.prepare("SELECT slug, name, status FROM listings WHERE slug = ? AND owner_user_id = ?")
    .get(listingSlug, ownerUserId) as { slug: string; name: string; status: string } | undefined;
  if (!listing || listing.status !== "published") {
    throw new CheckoutError(404, "Approved owned listing not found");
  }
  const plan = planByKey(planKey);
  if (!plan || !plan.enabled) throw new CheckoutError(404, "Available plan not found");

  const purchaseId = randomUUID();
  const session = await createSession({
    mode: "payment",
    client_reference_id: purchaseId,
    success_url: publicUrl(`/owner/listings/${encodeURIComponent(listingSlug)}/plans?checkout=return`),
    cancel_url: publicUrl(`/owner/listings/${encodeURIComponent(listingSlug)}/plans?checkout=cancel`),
    line_items: [{
      quantity: 1,
      price_data: {
        currency: plan.currency,
        unit_amount: plan.amountMinor,
        product_data: { name: `${plan.name} · ${listing.name}`, description: `${plan.durationDays} days of ${plan.featured ? "featured" : "standard"} placement` },
      },
    }],
    metadata: { purchaseId, listingSlug, ownerUserId, planKey },
    payment_intent_data: { metadata: { purchaseId, listingSlug } },
  }, { idempotencyKey: purchaseId });
  if (!session.id || !session.url) throw new CheckoutError(502, "Stripe did not provide a checkout URL");
  const checkoutUrl = new URL(session.url);
  if (checkoutUrl.protocol !== "https:" || checkoutUrl.hostname !== "checkout.stripe.com") {
    throw new CheckoutError(502, "Stripe returned an invalid checkout URL");
  }
  database.prepare(`INSERT INTO purchases
    (id, listing_slug, owner_user_id, plan_key, amount_minor, currency, duration_days,
      featured, stripe_session_id, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`).run(
    purchaseId, listingSlug, ownerUserId, plan.key, plan.amountMinor, plan.currency,
    plan.durationDays, Number(plan.featured), session.id, new Date().toISOString(),
  );
  return { purchaseId, url: session.url };
}
