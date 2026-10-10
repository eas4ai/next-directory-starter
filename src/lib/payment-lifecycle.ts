import { randomUUID } from "node:crypto";
import { database } from "@/lib/database";
import { migrateCatalog } from "@/lib/catalog-migrations";
import { HttpError, httpErrorResponse } from "@/lib/http-error";
import type { BillingMode, BillingProvider } from "@/lib/billing-profiles";
import { recordPurchaseNotification } from "@/lib/notifications";

migrateCatalog();

export class PaymentLifecycleError extends HttpError {}
export const paymentLifecycleErrorResponse = httpErrorResponse;

export type PaidEffect = {
  kind: "paid";
  purchaseId: string;
  resourceId: string;
  paymentId: string;
  subscriptionId?: string;
  chargeId?: string;
  priceId?: string;
  amountMinor: number;
  currency: string;
  periodStart?: string;
  periodEnd?: string;
};
export type PaymentEffect = PaidEffect | { kind: "noop" } | {
  kind: "subscription-linked";
  purchaseId: string;
  resourceId: string;
  subscriptionId: string;
} | {
  kind: "refund";
  paymentId: string;
  full: boolean;
  amountMinor: number;
  currency: string;
} | {
  kind: "dispute";
  paymentId: string;
  open: boolean;
} | {
  kind: "subscription-state";
  purchaseId: string;
  subscriptionId: string;
  state: "active" | "cancel-scheduled" | "canceled";
  occurredAt: string;
};

export type VerifiedEvidence = {
  provider: BillingProvider;
  mode: BillingMode;
  eventId: string;
  eventType: string;
  raw: unknown;
  effect: PaymentEffect;
};

type Purchase = {
  id: string; listing_slug: string; provider: BillingProvider;
  plan_mode: BillingMode; billing_mode: string; amount_minor: number; currency: string;
  duration_days: number; featured: number; provider_price_id: string | null;
  provider_resource_id: string | null; provider_subscription_id: string | null;
  stripe_session_id: string; checkout_request_id: string | null; status: string;
};

function bindEarlyResource(evidence: VerifiedEvidence, purchase: Purchase,
  resourceId: string, linkedSubscription = false): boolean {
  if (purchase.provider_resource_id !== null || purchase.status !== "pending" ||
      !purchase.checkout_request_id || purchase.stripe_session_id !== `pending:${purchase.id}` ||
      !resourceId || resourceId.length > 200) return false;
  const supported = evidence.provider === "stripe"
    ? (evidence.eventType === "checkout.session.completed" ||
        evidence.eventType === "checkout.session.async_payment_succeeded" ||
        evidence.eventType === "reconcile.session" ||
        evidence.eventType === "reconcile.subscription-link") &&
      (linkedSubscription ? purchase.billing_mode === "monthly" ||
        purchase.billing_mode === "annual" : purchase.billing_mode === "one-time")
    : !linkedSubscription && (evidence.provider === "paddle"
      ? evidence.eventType === "transaction.completed" ||
        evidence.eventType === "reconcile.transaction"
      : evidence.provider === "nowpayments" &&
        (evidence.eventType === "payment.status_changed" ||
          evidence.eventType === "reconcile.payment-finished"));
  if (!supported) return false;
  const updated = database.prepare(`UPDATE purchases SET provider_resource_id = ?,
    stripe_session_id = CASE WHEN provider = 'stripe' THEN ? ELSE stripe_session_id END
    WHERE id = ? AND provider = ? AND plan_mode = ? AND status = 'pending'
      AND provider_resource_id IS NULL AND stripe_session_id = ?`).run(
    resourceId, resourceId, purchase.id, evidence.provider, evidence.mode,
    `pending:${purchase.id}`,
  );
  return updated.changes === 1;
}

function paidPeriod(evidence: VerifiedEvidence, effect: PaidEffect): void {
  const purchase = database.prepare("SELECT * FROM purchases WHERE id = ?")
    .get(effect.purchaseId) as Purchase | undefined;
  if (!purchase || purchase.provider !== evidence.provider || purchase.plan_mode !== evidence.mode ||
      purchase.status === "refunded" || purchase.billing_mode === "free") {
    throw new PaymentLifecycleError(409, "Payment has no eligible matching purchase");
  }
  if (purchase.provider_price_id !== (effect.priceId ?? null) ||
      effect.amountMinor !== purchase.amount_minor ||
      effect.currency.toLowerCase() !== purchase.currency ||
      !effect.paymentId || effect.paymentId.length > 200) {
    throw new PaymentLifecycleError(409, "Payment terms do not match the accepted purchase");
  }
  const resourceMatches = effect.resourceId === purchase.provider_resource_id ||
    bindEarlyResource(evidence, purchase, effect.resourceId);
  const subscriptionMatches = Boolean(effect.subscriptionId &&
    effect.subscriptionId === purchase.provider_subscription_id);
  if (!resourceMatches && !subscriptionMatches) {
    throw new PaymentLifecycleError(409, "Payment resource does not match the purchase");
  }
  if (effect.subscriptionId && purchase.provider_subscription_id &&
      effect.subscriptionId !== purchase.provider_subscription_id) {
    throw new PaymentLifecycleError(409, "Payment subscription does not match the purchase");
  }
  if (purchase.billing_mode === "one-time") {
    const existing = database.prepare(`SELECT provider_payment_id FROM payment_periods
      WHERE purchase_id = ? LIMIT 1`).get(purchase.id) as
      { provider_payment_id: string } | undefined;
    if (existing && existing.provider_payment_id !== effect.paymentId) {
      throw new PaymentLifecycleError(409, "One-time purchase already has a paid period");
    }
  }
  const now = new Date();
  let startsAt = now.toISOString();
  let endsAt: string;
  if (purchase.billing_mode === "one-time") {
    if (purchase.duration_days < 1 || purchase.duration_days > 3650) {
      throw new PaymentLifecycleError(409, "Invalid accepted payment duration");
    }
    endsAt = new Date(now.getTime() + purchase.duration_days * 86_400_000).toISOString();
  } else {
    const start = Date.parse(effect.periodStart ?? "");
    const end = Date.parse(effect.periodEnd ?? "");
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start ||
        end - start > 400 * 86_400_000 || end <= now.getTime()) {
      throw new PaymentLifecycleError(409, "Paid billing period is invalid");
    }
    startsAt = new Date(start).toISOString();
    endsAt = new Date(end).toISOString();
  }
  const inserted = database.prepare(`INSERT INTO payment_periods
    (id, purchase_id, provider, provider_payment_id, amount_minor, currency, starts_at, ends_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(provider, provider_payment_id) DO NOTHING`).run(
    randomUUID(), purchase.id, evidence.provider, effect.paymentId,
    effect.amountMinor, purchase.currency, startsAt, endsAt,
  );
  if (!inserted.changes) {
    const prior = database.prepare(`SELECT purchase_id FROM payment_periods
      WHERE provider = ? AND provider_payment_id = ?`)
      .get(evidence.provider, effect.paymentId) as { purchase_id: string } | undefined;
    if (prior?.purchase_id !== purchase.id) {
      throw new PaymentLifecycleError(409, "Payment ID was already used for another purchase");
    }
    return;
  }
  if (effect.chargeId && effect.chargeId.length <= 200) {
    database.prepare(`UPDATE payment_periods SET provider_charge_id = ? WHERE provider = ?
      AND provider_payment_id = ?`).run(effect.chargeId, evidence.provider, effect.paymentId);
  }
  database.prepare("UPDATE purchases SET status = 'paid', provider_subscription_id = COALESCE(provider_subscription_id, ?) WHERE id = ?")
    .run(effect.subscriptionId ?? null, purchase.id);
  database.prepare(`INSERT INTO entitlements
    (purchase_id, listing_slug, starts_at, ends_at, featured, revoked_at)
    VALUES (?, ?, ?, ?, ?, NULL)
    ON CONFLICT(purchase_id) DO UPDATE SET
      ends_at = MAX(entitlements.ends_at, excluded.ends_at),
      revoked_at = NULL`).run(
    purchase.id, purchase.listing_slug, startsAt, endsAt, purchase.featured,
  );
  if (purchase.billing_mode !== "one-time") {
    database.prepare(`INSERT INTO subscription_states
      (purchase_id, provider_subscription_id, state, current_period_end, updated_at)
      VALUES (?, ?, 'active', ?, ?)
      ON CONFLICT(purchase_id) DO UPDATE SET
        provider_subscription_id = COALESCE(subscription_states.provider_subscription_id,
          excluded.provider_subscription_id),
        state = CASE WHEN subscription_states.state IN ('cancel-scheduled', 'canceled')
          THEN subscription_states.state ELSE 'active' END,
        current_period_end = MAX(subscription_states.current_period_end,
          excluded.current_period_end), updated_at = excluded.updated_at`).run(
      purchase.id, effect.subscriptionId ?? null, endsAt, now.toISOString(),
    );
  }
  recordPurchaseNotification(purchase.id, "payment.paid",
    `payment:${evidence.provider}:${evidence.mode}:${effect.paymentId}:paid`,
    "Payment confirmed", "Your publishing payment was confirmed.");
}

function refreshEntitlement(purchaseId: string): void {
  const active = database.prepare(`SELECT MIN(starts_at) AS starts_at, MAX(ends_at) AS ends_at
    FROM payment_periods WHERE purchase_id = ? AND refunded_at IS NULL AND disputed_at IS NULL`)
    .get(purchaseId) as { starts_at: string | null; ends_at: string | null };
  if (active.ends_at) {
    database.prepare(`UPDATE entitlements SET starts_at = ?, ends_at = ?, revoked_at = NULL
      WHERE purchase_id = ?`).run(active.starts_at, active.ends_at, purchaseId);
  } else {
    database.prepare(`UPDATE entitlements SET revoked_at = ? WHERE purchase_id = ?
      AND revoked_at IS NULL`).run(new Date().toISOString(), purchaseId);
  }
}

function matchingPeriod(evidence: VerifiedEvidence, paymentId: string): {
  id: string; purchase_id: string; amount_minor: number; currency: string;
  billing_mode: string;
} {
  if (!paymentId || paymentId.length > 200) throw new PaymentLifecycleError(400, "Invalid payment reference");
  const rows = database.prepare(`SELECT pp.id, pp.purchase_id, pp.amount_minor, pp.currency,
      p.billing_mode FROM payment_periods pp JOIN purchases p ON p.id = pp.purchase_id
    WHERE pp.provider = ? AND p.provider = ? AND p.plan_mode = ?
      AND (pp.provider_payment_id = ? OR pp.provider_charge_id = ?)`)
    .all(evidence.provider, evidence.provider, evidence.mode, paymentId, paymentId) as
      { id: string; purchase_id: string; amount_minor: number; currency: string; billing_mode: string }[];
  if (rows.length !== 1) throw new PaymentLifecycleError(409, "Payment outcome has no unique paid period");
  return rows[0];
}

function refundPeriod(evidence: VerifiedEvidence,
  effect: Extract<PaymentEffect, { kind: "refund" }>): void {
  const period = matchingPeriod(evidence, effect.paymentId);
  if (!Number.isSafeInteger(effect.amountMinor) || effect.amountMinor <= 0 ||
      effect.currency.toLowerCase() !== period.currency) {
    throw new PaymentLifecycleError(409, "Refund terms do not match the paid period");
  }
  if (!effect.full) return;
  const changed = database.prepare("UPDATE payment_periods SET refunded_at = ? WHERE id = ? AND refunded_at IS NULL")
    .run(new Date().toISOString(), period.id);
  if (!changed.changes) return;
  if (period.billing_mode === "one-time") {
    database.prepare("UPDATE purchases SET status = 'refunded' WHERE id = ?")
      .run(period.purchase_id);
  }
  refreshEntitlement(period.purchase_id);
  recordPurchaseNotification(period.purchase_id, "payment.refunded",
    `payment:${evidence.provider}:${evidence.mode}:${effect.paymentId}:refunded`,
    "Payment refunded", "A publishing payment was fully refunded.");
}

function disputePeriod(evidence: VerifiedEvidence,
  effect: Extract<PaymentEffect, { kind: "dispute" }>): void {
  const period = matchingPeriod(evidence, effect.paymentId);
  const changed = database.prepare(`UPDATE payment_periods SET disputed_at = ? WHERE id = ?
    AND ${effect.open ? "disputed_at IS NULL" : "disputed_at IS NOT NULL"}`).run(
    effect.open ? new Date().toISOString() : null, period.id);
  if (!changed.changes) return;
  refreshEntitlement(period.purchase_id);
  recordPurchaseNotification(period.purchase_id,
    effect.open ? "payment.dispute-open" : "payment.dispute-closed",
    `payment:${evidence.provider}:${evidence.mode}:${evidence.eventId}:dispute`,
    effect.open ? "Payment dispute opened" : "Payment dispute closed",
    effect.open ? "A publishing payment is under dispute." : "The publishing payment dispute closed.");
}

function subscriptionState(evidence: VerifiedEvidence,
  effect: Extract<PaymentEffect, { kind: "subscription-state" }>): void {
  const occurred = Date.parse(effect.occurredAt);
  if (!Number.isFinite(occurred) || !effect.subscriptionId || effect.subscriptionId.length > 200) {
    throw new PaymentLifecycleError(400, "Invalid subscription state evidence");
  }
  const purchase = database.prepare(`SELECT id FROM purchases WHERE id = ? AND provider = ?
    AND plan_mode = ? AND provider_subscription_id = ?
    AND billing_mode IN ('monthly', 'annual')`).get(
    effect.purchaseId, evidence.provider, evidence.mode, effect.subscriptionId,
  ) as { id: string } | undefined;
  if (!purchase) throw new PaymentLifecycleError(409, "Subscription does not match the purchase");
  const prior = database.prepare("SELECT state FROM subscription_states WHERE purchase_id = ?")
    .get(purchase.id) as { state: string } | undefined;
  const now = new Date().toISOString();
  const changed = database.prepare(`INSERT INTO subscription_states
    (purchase_id, provider_subscription_id, state, current_period_end, updated_at, provider_event_at)
    VALUES (?, ?, ?, NULL, ?, ?)
    ON CONFLICT(purchase_id) DO UPDATE SET
      state = excluded.state, updated_at = excluded.updated_at,
      provider_event_at = excluded.provider_event_at
    WHERE subscription_states.provider_event_at IS NULL
      OR subscription_states.provider_event_at <= excluded.provider_event_at`).run(
    purchase.id, effect.subscriptionId, effect.state, now,
    new Date(occurred).toISOString(),
  );
  if (changed.changes && prior?.state !== effect.state) {
    recordPurchaseNotification(purchase.id, `payment.${effect.state}`,
      `payment:${evidence.provider}:${evidence.mode}:${evidence.eventId}:subscription`,
      "Subscription status changed", `Your publishing subscription is now ${effect.state}.`);
  }
}

function applyEffect(evidence: VerifiedEvidence): void {
  if (evidence.effect.kind === "paid") paidPeriod(evidence, evidence.effect);
  if (evidence.effect.kind === "refund") refundPeriod(evidence, evidence.effect);
  if (evidence.effect.kind === "dispute") disputePeriod(evidence, evidence.effect);
  if (evidence.effect.kind === "subscription-state") subscriptionState(evidence, evidence.effect);
  if (evidence.effect.kind === "subscription-linked") {
    const { purchaseId, resourceId, subscriptionId } = evidence.effect;
    if (!subscriptionId || subscriptionId.length > 200) {
      throw new PaymentLifecycleError(400, "Invalid provider subscription ID");
    }
    const purchase = database.prepare("SELECT * FROM purchases WHERE id = ?")
      .get(purchaseId) as Purchase | undefined;
    if (!purchase || purchase.provider !== evidence.provider || purchase.plan_mode !== evidence.mode ||
        (purchase.provider_resource_id !== resourceId &&
          !bindEarlyResource(evidence, purchase, resourceId, true))) {
      throw new PaymentLifecycleError(409, "Subscription does not match the checkout purchase");
    }
    const changed = database.prepare(`UPDATE purchases SET provider_subscription_id = ?
      WHERE id = ? AND provider = ? AND plan_mode = ? AND provider_resource_id = ?
        AND billing_mode IN ('monthly', 'annual')
        AND (provider_subscription_id IS NULL OR provider_subscription_id = ?)`).run(
      subscriptionId, purchaseId, evidence.provider, evidence.mode, resourceId, subscriptionId,
    );
    if (changed.changes !== 1) {
      throw new PaymentLifecycleError(409, "Subscription does not match the checkout purchase");
    }
  }
}

export function retainVerifiedEvidence(evidence: VerifiedEvidence,
  options: { retryExhausted?: boolean } = {}): { processed: boolean } {
  if (!evidence.eventId || evidence.eventId.length > 200 || !evidence.eventType ||
      evidence.eventType.length > 200) {
    throw new PaymentLifecycleError(400, "Invalid payment event envelope");
  }
  const payload = JSON.stringify({ raw: evidence.raw, effect: evidence.effect });
  if (payload.length > 1_000_000) throw new PaymentLifecycleError(413, "Payment event is too large");
  return database.transaction(() => {
    database.prepare(`INSERT INTO payment_evidence
      (provider, mode, event_id, event_type, payload, state, received_at)
      VALUES (?, ?, ?, ?, ?, 'pending', ?)
      ON CONFLICT(provider, mode, event_id) DO NOTHING`).run(
      evidence.provider, evidence.mode, evidence.eventId, evidence.eventType,
      payload, new Date().toISOString(),
    );
    const current = database.prepare(`SELECT payload, state, attempts FROM payment_evidence
      WHERE provider = ? AND mode = ? AND event_id = ?`)
      .get(evidence.provider, evidence.mode, evidence.eventId) as
        { payload: string; state: string; attempts: number };
    if (current.payload !== payload) throw new PaymentLifecycleError(409, "Event ID has conflicting evidence");
    if (current.state === "processed") return { processed: true };
    if (current.attempts >= 8 && !options.retryExhausted) return { processed: false };
    try {
      database.transaction(() => applyEffect(evidence))();
      database.prepare(`UPDATE payment_evidence SET state = 'processed', attempts = attempts + 1,
        processed_at = ?, error = NULL WHERE provider = ? AND mode = ? AND event_id = ?`).run(
        new Date().toISOString(), evidence.provider, evidence.mode, evidence.eventId,
      );
      return { processed: true };
    } catch (error) {
      const reason = error instanceof PaymentLifecycleError ? error.message : "Payment evidence processing failed";
      database.prepare(`UPDATE payment_evidence SET state = 'unresolved', attempts = attempts + 1,
        error = ? WHERE provider = ? AND mode = ? AND event_id = ?`).run(
        reason, evidence.provider, evidence.mode, evidence.eventId,
      );
      return { processed: false };
    }
  }).immediate();
}
