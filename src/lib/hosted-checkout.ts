import { randomUUID } from "node:crypto";
import { database } from "@/lib/database";
import { migrateCatalog } from "@/lib/catalog-migrations";
import { checkoutConfiguration, type BillingProvider, type CheckoutConfiguration } from "@/lib/billing-profiles";
import { CheckoutError } from "@/lib/checkout";
import { checkoutMode, planByKey, planOfferToken, type PublishingPlan } from "@/lib/plans";
import { createHostedSession, type CreateHostedSession, type HostedPurchase } from "@/lib/payment-provider";

migrateCatalog();

type PurchaseRow = {
  id: string; listing_slug: string; owner_user_id: string; plan_key: string;
  plan_mode: "test" | "live"; billing_mode: PublishingPlan["billingMode"];
  plan_name: string; plan_description: string; amount_minor: number; currency: string;
  accepted_duration_days: number | null; featured: number;
  provider: BillingProvider; provider_price_id: string | null;
  provider_resource_id: string | null; checkout_url: string | null; status: string;
};

type Reservation = { id: string; created: false; existingUrl: string | null } |
  { id: string; purchase: HostedPurchase; configuration: CheckoutConfiguration; created: true };

type CheckoutInput = { planKey: string; offerToken: string; provider: BillingProvider; requestId: string };

function reserve(ownerUserId: string, listingSlug: string, input: CheckoutInput): Reservation {
  const { planKey, offerToken, provider, requestId } = input;
  return database.transaction(() => {
    const listing = database.prepare(`SELECT slug FROM listings
      WHERE slug = ? AND owner_user_id = ? AND status = 'published'`)
      .get(listingSlug, ownerUserId);
    if (!listing) throw new CheckoutError(404, "Approved owned listing not found");
    const existing = database.prepare(`SELECT * FROM purchases
      WHERE owner_user_id = ? AND checkout_request_id = ?`)
      .get(ownerUserId, requestId) as PurchaseRow | undefined;
    if (existing) {
      const priorOffer = planOfferToken({ key: existing.plan_key, name: existing.plan_name,
        description: existing.plan_description, mode: existing.plan_mode,
        billingMode: existing.billing_mode, amountMinor: existing.amount_minor,
        currency: existing.currency, durationDays: existing.accepted_duration_days,
        featured: Boolean(existing.featured) });
      if (existing.listing_slug !== listingSlug || existing.plan_key !== planKey ||
          existing.provider !== provider || priorOffer !== offerToken) {
        throw new CheckoutError(409, "Checkout request was already used for different terms");
      }
      return { id: existing.id, created: false, existingUrl: existing.checkout_url } as const;
    }
    const plan = planByKey(planKey);
    if (!plan || !plan.enabled || plan.mode !== checkoutMode() || plan.billingMode === "free" ||
        (provider === "nowpayments" && plan.billingMode !== "one-time")) {
      throw new CheckoutError(404, "Eligible publishing plan not found");
    }
    if (planOfferToken(plan) !== offerToken) {
      throw new CheckoutError(409, "Plan terms changed. Refresh and review the plan");
    }
    const configuration = checkoutConfiguration(provider, plan.mode);
    if (!configuration) throw new CheckoutError(503, "Payment provider is unavailable for this mode");
    const providerPriceId = configuration.priceMappings.find((entry) => entry.planKey === plan.key)?.priceId ?? null;
    if (provider !== "nowpayments" && !providerPriceId &&
        !(provider === "stripe" && configuration.legacy && plan.billingMode === "one-time")) {
      throw new CheckoutError(409, "The plan has no price mapping for this provider and mode");
    }
    const id = randomUUID();
    database.prepare(`INSERT INTO purchases
      (id, listing_slug, owner_user_id, plan_key, plan_mode, billing_mode, plan_name,
        plan_description, amount_minor, currency, duration_days, accepted_duration_days, featured,
        stripe_session_id, stripe_product_name, checkout_request_id, status, created_at,
        provider, provider_price_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`).run(
      id, listingSlug, ownerUserId, plan.key, plan.mode, plan.billingMode, plan.name,
      plan.description, plan.amountMinor, plan.currency, plan.durationDays ?? 0,
      plan.durationDays, Number(plan.featured), `pending:${id}`, plan.name,
      requestId, new Date().toISOString(), provider, providerPriceId,
    );
    return { id, purchase: {
      id, listingSlug, ownerUserId,
      plan: { key: plan.key, name: plan.name, billingMode: plan.billingMode,
        amountMinor: plan.amountMinor, currency: plan.currency, durationDays: plan.durationDays },
      providerPriceId,
    }, configuration, created: true } as const;
  }).immediate();
}

export async function createHostedCheckout(ownerUserId: string, listingSlug: string,
  input: CheckoutInput,
  createSession: CreateHostedSession = createHostedSession): Promise<{ purchaseId: string; url: string }> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.requestId) ||
      !/^[0-9a-f]{64}$/.test(input.offerToken)) {
    throw new CheckoutError(400, "Invalid checkout request or plan terms");
  }
  const reserved = reserve(ownerUserId, listingSlug, input);
  if (!reserved.created) {
    if (reserved.existingUrl) return { purchaseId: reserved.id, url: reserved.existingUrl };
    throw new CheckoutError(409, "Checkout is pending. Contact the operator before retrying this purchase");
  }
  let session;
  try { session = await createSession(reserved.purchase, reserved.configuration); }
  catch { throw new CheckoutError(502, "Provider checkout status is unknown. Contact the operator before retrying"); }
  const url = new URL(session.url);
  if (url.protocol !== "https:" || !session.resourceId || session.resourceId.length > 200 ||
      (input.provider === "stripe" && url.hostname !== "checkout.stripe.com") ||
      (input.provider === "nowpayments" &&
        !(url.hostname === "nowpayments.io" || url.hostname.endsWith(".nowpayments.io")))) {
    throw new CheckoutError(502, "Provider returned an invalid hosted checkout URL");
  }
  database.transaction(() => {
    const changed = database.prepare(`UPDATE purchases SET provider_resource_id = ?, checkout_url = ?,
      stripe_session_id = CASE WHEN provider = 'stripe' THEN ? ELSE stripe_session_id END
      WHERE id = ? AND status = 'pending' AND provider_resource_id IS NULL`).run(
      session.resourceId, url.toString(), session.resourceId, reserved.purchase.id,
    );
    if (changed.changes !== 1) throw new CheckoutError(409, "Checkout changed before its response was saved");
  }).immediate();
  return { purchaseId: reserved.purchase.id, url: url.toString() };
}
