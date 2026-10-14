import Stripe from "stripe";
import { Environment, Paddle } from "@paddle/paddle-node-sdk";
import { database } from "@/lib/database";
import { migrateCatalog } from "@/lib/catalog-migrations";
import { recordAudit } from "@/lib/audit";
import { providerRecoveryConfiguration, type BillingMode, type BillingProvider } from "@/lib/billing-profiles";
import { HttpError, httpErrorResponse } from "@/lib/http-error";
import { retainVerifiedEvidence } from "@/lib/payment-lifecycle";

migrateCatalog();

export class OwnerBillingError extends HttpError {}
export const ownerBillingErrorResponse = httpErrorResponse;

type Row = {
  id: string; listing_slug: string; plan_name: string; billing_mode: string;
  plan_mode: BillingMode; provider: BillingProvider; amount_minor: number;
  currency: string; status: string; created_at: string; checkout_url: string | null;
  provider_resource_id: string | null;
  checkout_terminal_state: "expired" | "canceled" | null;
  provider_subscription_id: string | null; ends_at: string | null;
  revoked_at: string | null; subscription_state: string | null;
  refunded_periods: number; disputed_periods: number; valid_periods: number;
};

export type OwnerPurchase = {
  id: string; listingSlug: string; planName: string; billingMode: string;
  mode: BillingMode; provider: BillingProvider; amountMinor: number; currency: string;
  status: "pending" | "paid" | "cancel-scheduled" | "canceled" | "expired" |
    "refunded" | "disputed";
  benefitActive: boolean; paidUntil: string | null; createdAt: string;
  checkoutUrl: string | null; canCancel: boolean;
  cancellationKind: "checkout" | "subscription" | null;
};

function ownerPurchaseRows(ownerUserId: string): Row[] {
  return database.prepare(`SELECT p.id, p.listing_slug, p.plan_name, p.billing_mode,
      p.plan_mode, p.provider, p.amount_minor, p.currency, p.status, p.created_at,
      p.checkout_url, p.provider_resource_id, p.checkout_terminal_state,
      p.provider_subscription_id, e.ends_at, e.revoked_at,
      s.state AS subscription_state,
      (SELECT COUNT(*) FROM payment_periods pp WHERE pp.purchase_id = p.id
        AND pp.refunded_at IS NOT NULL) AS refunded_periods,
      (SELECT COUNT(*) FROM payment_periods pp WHERE pp.purchase_id = p.id
        AND pp.disputed_at IS NOT NULL) AS disputed_periods,
      (SELECT COUNT(*) FROM payment_periods pp WHERE pp.purchase_id = p.id
        AND pp.refunded_at IS NULL AND pp.disputed_at IS NULL) AS valid_periods
    FROM purchases p LEFT JOIN entitlements e ON e.purchase_id = p.id
      LEFT JOIN subscription_states s ON s.purchase_id = p.id
    WHERE p.owner_user_id = ? ORDER BY p.created_at DESC, p.id DESC LIMIT 100`)
    .all(ownerUserId) as Row[];
}

function displayStatus(row: Row, benefitActive: boolean): OwnerPurchase["status"] {
  if (row.checkout_terminal_state === "expired") return "expired";
  if (row.checkout_terminal_state === "canceled") return "canceled";
  if (row.status === "pending") return "pending";
  if (row.status === "refunded" || row.refunded_periods > 0 && row.valid_periods === 0) {
    return "refunded";
  }
  if (row.disputed_periods > 0 && row.valid_periods === 0) return "disputed";
  if (row.subscription_state === "cancel-scheduled") return "cancel-scheduled";
  if (row.subscription_state === "canceled") return "canceled";
  if (benefitActive || row.billing_mode === "free") return "paid";
  return "expired";
}

export function listOwnerBilling(ownerUserId: string): OwnerPurchase[] {
  const now = new Date().toISOString();
  return ownerPurchaseRows(ownerUserId).map((row) => {
    const benefitActive = row.status === "paid" && row.revoked_at === null &&
      row.ends_at !== null && row.ends_at > now;
    const status = displayStatus(row, benefitActive);
    const cancellationKind = row.status === "pending" && row.checkout_terminal_state === null &&
      row.provider === "stripe" && Boolean(row.provider_resource_id)
      ? "checkout" : row.status === "paid" &&
        (row.billing_mode === "monthly" || row.billing_mode === "annual") &&
        Boolean(row.provider_subscription_id) &&
        (row.provider === "stripe" || row.provider === "paddle") &&
        !["cancel-scheduled", "canceled"].includes(row.subscription_state ?? "")
        ? "subscription" : null;
    return {
      id: row.id, listingSlug: row.listing_slug, planName: row.plan_name,
      billingMode: row.billing_mode, mode: row.plan_mode, provider: row.provider,
      amountMinor: row.amount_minor, currency: row.currency,
      status, benefitActive, paidUntil: row.ends_at, createdAt: row.created_at,
      checkoutUrl: status === "pending" ? row.checkout_url : null,
      canCancel: cancellationKind !== null, cancellationKind,
    };
  });
}

export type CancelProvider = (provider: "stripe" | "paddle", mode: BillingMode,
  subscriptionId: string) => Promise<void>;

const cancelAtPeriodEnd: CancelProvider = async (provider, mode, subscriptionId) => {
  const config = providerRecoveryConfiguration(provider, mode);
  if (!config) throw new OwnerBillingError(503, "Provider recovery credentials are unavailable");
  if (provider === "stripe") {
    const subscription = await new Stripe(config.apiKey, {
      httpClient: Stripe.createFetchHttpClient(),
    }).subscriptions.update(
      subscriptionId, { cancel_at_period_end: true },
      { idempotencyKey: `directory-cancel:${subscriptionId}` },
    );
    if (subscription.id !== subscriptionId || !subscription.cancel_at_period_end) {
      throw new OwnerBillingError(502, "Stripe did not schedule cancellation");
    }
  } else {
    const paddle = new Paddle(config.apiKey, {
      environment: mode === "test" ? Environment.sandbox : Environment.production,
    });
    const subscription = await paddle.subscriptions.cancel(subscriptionId,
      { effectiveFrom: "next_billing_period" });
    if (subscription.id !== subscriptionId || subscription.scheduledChange?.action !== "cancel") {
      throw new OwnerBillingError(502, "Paddle did not schedule cancellation");
    }
  }
};

export type ExpireCheckoutProvider = (mode: BillingMode, resourceId: string,
  purchaseId: string) => Promise<{ occurredAt: string }>;

const expireStripeCheckout: ExpireCheckoutProvider = async (mode, resourceId, purchaseId) => {
  const config = providerRecoveryConfiguration("stripe", mode);
  if (!config) throw new OwnerBillingError(503, "Stripe recovery credentials are unavailable");
  const stripe = new Stripe(config.apiKey, { httpClient: Stripe.createFetchHttpClient() });
  let session;
  try {
    session = await stripe.checkout.sessions.expire(resourceId, {}, {
      idempotencyKey: `directory-expire:${purchaseId}`,
    });
  } catch {
    session = await stripe.checkout.sessions.retrieve(resourceId);
  }
  if (session.id !== resourceId || session.status !== "expired" ||
      session.client_reference_id !== purchaseId) {
    throw new OwnerBillingError(502, "Stripe did not confirm checkout expiry");
  }
  return { occurredAt: new Date(session.expires_at * 1000).toISOString() };
};

export async function cancelOwnerPurchase(ownerUserId: string, purchaseId: string,
  cancelProvider: CancelProvider = cancelAtPeriodEnd,
  expireCheckout: ExpireCheckoutProvider = expireStripeCheckout):
  Promise<{ status: "cancel-scheduled" | "expired" | "canceled" }> {
  const purchase = database.prepare(`SELECT id, provider, plan_mode, billing_mode,
      provider_resource_id, provider_subscription_id, status, checkout_terminal_state
    FROM purchases
    WHERE id = ? AND owner_user_id = ?`).get(purchaseId, ownerUserId) as
      { id: string; provider: BillingProvider; plan_mode: BillingMode;
        provider_resource_id: string | null;
        billing_mode: string; provider_subscription_id: string | null;
        status: string; checkout_terminal_state: "expired" | "canceled" | null } | undefined;
  if (!purchase) throw new OwnerBillingError(404, "Purchase not found");
  if (purchase.checkout_terminal_state) return { status: purchase.checkout_terminal_state };
  if (purchase.status === "pending" && purchase.provider === "stripe" &&
      purchase.provider_resource_id) {
    let terminal;
    try {
      terminal = await expireCheckout(purchase.plan_mode, purchase.provider_resource_id, purchase.id);
    } catch (error) {
      if (error instanceof OwnerBillingError) throw error;
      throw new OwnerBillingError(502,
        "Provider checkout status is unknown. Check billing before retrying");
    }
    const result = retainVerifiedEvidence({
      provider: "stripe", mode: purchase.plan_mode,
      eventId: `owner-expire:${purchase.id}`, eventType: "owner.checkout.expired",
      raw: { purchaseId: purchase.id, resourceId: purchase.provider_resource_id,
        occurredAt: terminal.occurredAt },
      effect: { kind: "checkout-terminal", purchaseId: purchase.id,
        resourceId: purchase.provider_resource_id, state: "expired",
        occurredAt: terminal.occurredAt },
    });
    if (!result.processed) {
      throw new OwnerBillingError(409, "Checkout changed before its expiry was recorded");
    }
    recordAudit("billing.checkout-expire", ownerUserId, purchaseId);
    return { status: "expired" };
  }
  const state = database.prepare("SELECT state FROM subscription_states WHERE purchase_id = ?")
    .get(purchaseId) as { state: string } | undefined;
  if (state?.state === "cancel-scheduled") return { status: "cancel-scheduled" };
  if (purchase.status !== "paid" || !["monthly", "annual"].includes(purchase.billing_mode) ||
      !purchase.provider_subscription_id ||
      (purchase.provider !== "stripe" && purchase.provider !== "paddle") ||
      state?.state === "canceled") {
    throw new OwnerBillingError(409, "This purchase does not support cancellation");
  }
  try {
    await cancelProvider(purchase.provider, purchase.plan_mode, purchase.provider_subscription_id);
  } catch (error) {
    if (error instanceof OwnerBillingError) throw error;
    throw new OwnerBillingError(502, "Provider cancellation status is unknown. Check billing before retrying");
  }
  database.transaction(() => {
    const current = database.prepare(`SELECT state FROM subscription_states WHERE purchase_id = ?`)
      .get(purchaseId) as { state: string } | undefined;
    if (current?.state !== "canceled") {
      database.prepare(`INSERT INTO subscription_states
        (purchase_id, provider_subscription_id, state, current_period_end, updated_at)
        VALUES (?, ?, 'cancel-scheduled', NULL, ?)
        ON CONFLICT(purchase_id) DO UPDATE SET state = 'cancel-scheduled', updated_at = excluded.updated_at`).run(
        purchaseId, purchase.provider_subscription_id, new Date().toISOString(),
      );
    }
    recordAudit("billing.cancel-request", ownerUserId, purchaseId);
  }).immediate();
  return { status: "cancel-scheduled" };
}
