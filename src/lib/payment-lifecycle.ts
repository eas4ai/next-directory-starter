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
  paymentIntentId?: string;
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
  refundId?: string;
  full: boolean;
  amountMinor: number;
  currency: string;
} | {
  kind: "dispute";
  paymentId: string;
  disputeId: string;
  open: boolean;
  terminal: boolean;
  occurredAt: string;
  closesPrior?: boolean;
} | {
  kind: "subscription-state";
  purchaseId: string;
  subscriptionId: string;
  state: "active" | "cancel-scheduled" | "canceled";
  occurredAt: string;
} | {
  kind: "checkout-terminal";
  purchaseId: string;
  resourceId: string;
  state: "expired" | "canceled";
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
  checkout_terminal_state: "expired" | "canceled" | null;
  checkout_terminal_at: string | null;
};

function bindEarlyResource(evidence: VerifiedEvidence, purchase: Purchase,
  resourceId: string, linkedSubscription = false): boolean {
  if (purchase.provider_resource_id !== null || purchase.status !== "pending" ||
      purchase.checkout_terminal_state !== null ||
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

type PaymentAssociations = { paymentIntentId: string | null; chargeId: string | null };

function paymentAssociations(effect: PaidEffect): PaymentAssociations {
  const paymentIntentId = effect.paymentIntentId ?? null;
  const chargeId = effect.chargeId ?? null;
  if ((paymentIntentId !== null && (!paymentIntentId || paymentIntentId.length > 200)) ||
      (chargeId !== null && (!chargeId || chargeId.length > 200))) {
    throw new PaymentLifecycleError(400, "Invalid payment association");
  }
  return { paymentIntentId, chargeId };
}

function enrichPaymentAssociations(provider: BillingProvider, purchaseId: string,
  paymentId: string, associations: PaymentAssociations): void {
  const prior = database.prepare(`SELECT id, purchase_id, provider_payment_intent_id,
      provider_charge_id FROM payment_periods
    WHERE provider = ? AND provider_payment_id = ?`)
    .get(provider, paymentId) as { id: string; purchase_id: string;
      provider_payment_intent_id: string | null; provider_charge_id: string | null } | undefined;
  if (prior?.purchase_id !== purchaseId) {
    throw new PaymentLifecycleError(409, "Payment ID was already used for another purchase");
  }
  if ((associations.paymentIntentId && prior.provider_payment_intent_id &&
      prior.provider_payment_intent_id !== associations.paymentIntentId) ||
      (associations.chargeId && prior.provider_charge_id &&
        prior.provider_charge_id !== associations.chargeId)) {
    throw new PaymentLifecycleError(409, "Payment association conflicts with prior evidence");
  }
  database.prepare(`UPDATE payment_periods SET
    provider_payment_intent_id = COALESCE(provider_payment_intent_id, ?),
    provider_charge_id = COALESCE(provider_charge_id, ?)
    WHERE id = ?`).run(associations.paymentIntentId, associations.chargeId, prior.id);
}

function paidPeriod(evidence: VerifiedEvidence, effect: PaidEffect): void {
  const purchase = database.prepare("SELECT * FROM purchases WHERE id = ?")
    .get(effect.purchaseId) as Purchase | undefined;
  if (!purchase || purchase.provider !== evidence.provider || purchase.plan_mode !== evidence.mode ||
      purchase.status === "refunded" || purchase.billing_mode === "free" ||
      purchase.checkout_terminal_state !== null) {
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
  const associations = paymentAssociations(effect);
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
    (id, purchase_id, provider, provider_payment_id, provider_payment_intent_id,
      provider_charge_id, amount_minor, currency, starts_at, ends_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(provider, provider_payment_id) DO NOTHING`).run(
    randomUUID(), purchase.id, evidence.provider, effect.paymentId,
    associations.paymentIntentId, associations.chargeId,
    effect.amountMinor, purchase.currency, startsAt, endsAt,
  );
  if (!inserted.changes) {
    enrichPaymentAssociations(evidence.provider, purchase.id, effect.paymentId, associations);
    return;
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

function terminalCheckout(evidence: VerifiedEvidence,
  effect: Extract<PaymentEffect, { kind: "checkout-terminal" }>): void {
  if (!effect.resourceId || effect.resourceId.length > 200 ||
      !Number.isFinite(Date.parse(effect.occurredAt))) {
    throw new PaymentLifecycleError(400, "Invalid terminal checkout evidence");
  }
  const purchase = database.prepare("SELECT * FROM purchases WHERE id = ?")
    .get(effect.purchaseId) as Purchase | undefined;
  if (!purchase || purchase.provider !== evidence.provider || purchase.plan_mode !== evidence.mode ||
      purchase.billing_mode === "free") {
    throw new PaymentLifecycleError(409, "Terminal checkout has no matching purchase");
  }
  const resourceMatches = purchase.provider_resource_id === effect.resourceId;
  const earlyStripe = evidence.provider === "stripe" && purchase.provider_resource_id === null &&
    purchase.checkout_request_id !== null && purchase.stripe_session_id === `pending:${purchase.id}` &&
    (evidence.eventType === "checkout.session.expired" ||
      evidence.eventType === "reconcile.session-expired");
  if (!resourceMatches && !earlyStripe) {
    throw new PaymentLifecycleError(409, "Terminal checkout resource does not match the purchase");
  }
  if (purchase.checkout_terminal_state !== null) {
    if (purchase.checkout_terminal_state !== effect.state) {
      throw new PaymentLifecycleError(409, "Checkout already has a different terminal state");
    }
    return;
  }
  if (purchase.status !== "pending") {
    throw new PaymentLifecycleError(409, "Checkout already has a payment outcome");
  }
  const changed = database.prepare(`UPDATE purchases SET
      provider_resource_id = COALESCE(provider_resource_id, ?),
      stripe_session_id = CASE WHEN provider_resource_id IS NULL AND provider = 'stripe'
        THEN ? ELSE stripe_session_id END,
      checkout_url = NULL, checkout_terminal_state = ?, checkout_terminal_at = ?
    WHERE id = ? AND provider = ? AND plan_mode = ? AND status = 'pending'
      AND checkout_terminal_state IS NULL
      AND (provider_resource_id = ? OR (provider = 'stripe' AND provider_resource_id IS NULL
        AND checkout_request_id IS NOT NULL AND stripe_session_id = 'pending:' || id))`).run(
    effect.resourceId, effect.resourceId, effect.state, effect.occurredAt,
    purchase.id, evidence.provider, evidence.mode, effect.resourceId,
  );
  if (changed.changes !== 1) {
    throw new PaymentLifecycleError(409, "Checkout changed before its terminal state was recorded");
  }
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

type PaymentPeriod = {
  id: string; purchase_id: string; amount_minor: number; currency: string;
  billing_mode: string;
};

function matchingPeriod(evidence: VerifiedEvidence, paymentId: string): PaymentPeriod {
  if (!paymentId || paymentId.length > 200) throw new PaymentLifecycleError(400, "Invalid payment reference");
  const rows = database.prepare(`SELECT pp.id, pp.purchase_id, pp.amount_minor, pp.currency,
      p.billing_mode FROM payment_periods pp JOIN purchases p ON p.id = pp.purchase_id
    WHERE pp.provider = ? AND p.provider = ? AND p.plan_mode = ?
      AND (pp.provider_payment_id = ? OR pp.provider_payment_intent_id = ?
        OR pp.provider_charge_id = ?)`)
    .all(evidence.provider, evidence.provider, evidence.mode, paymentId, paymentId, paymentId) as
      { id: string; purchase_id: string; amount_minor: number; currency: string; billing_mode: string }[];
  if (rows.length !== 1) throw new PaymentLifecycleError(409, "Payment outcome has no unique paid period");
  return rows[0];
}

function paddleRefundFullyRefunded(period: PaymentPeriod,
  effect: Extract<PaymentEffect, { kind: "refund" }>): boolean {
  if (!effect.refundId) {
    if (effect.full) return true;
    throw new PaymentLifecycleError(409, "Paddle partial refund has no stable adjustment ID");
  }
  if (effect.refundId.length > 200 || effect.amountMinor > period.amount_minor) {
    throw new PaymentLifecycleError(409, "Paddle refund terms do not match the paid period");
  }
  const prior = database.prepare(`SELECT payment_period_id, amount_minor, currency
    FROM payment_refunds WHERE provider = 'paddle' AND provider_refund_id = ?`)
    .get(effect.refundId) as { payment_period_id: string; amount_minor: number;
      currency: string } | undefined;
  if (prior && (prior.payment_period_id !== period.id ||
      prior.amount_minor !== effect.amountMinor || prior.currency !== period.currency)) {
    throw new PaymentLifecycleError(409, "Paddle refund conflicts with prior evidence");
  }
  if (!prior) {
    database.prepare(`INSERT INTO payment_refunds
      (provider, provider_refund_id, payment_period_id, amount_minor, currency, recorded_at)
      VALUES ('paddle', ?, ?, ?, ?, ?)`).run(
      effect.refundId, period.id, effect.amountMinor, period.currency,
      new Date().toISOString(),
    );
  }
  const refunds = database.prepare(`SELECT amount_minor FROM payment_refunds
    WHERE provider = 'paddle' AND payment_period_id = ?`).all(period.id) as
      { amount_minor: number }[];
  let total = 0;
  for (const refund of refunds) {
    total = Math.min(period.amount_minor, total + refund.amount_minor);
  }
  return effect.full || total >= period.amount_minor;
}

function refundPeriod(evidence: VerifiedEvidence,
  effect: Extract<PaymentEffect, { kind: "refund" }>): void {
  const period = matchingPeriod(evidence, effect.paymentId);
  if (!Number.isSafeInteger(effect.amountMinor) || effect.amountMinor <= 0 ||
      effect.currency.toLowerCase() !== period.currency) {
    throw new PaymentLifecycleError(409, "Refund terms do not match the paid period");
  }
  const fullyRefunded = evidence.provider === "paddle"
    ? paddleRefundFullyRefunded(period, effect)
    : effect.full;
  if (!fullyRefunded) return;
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

type DisputeEffect = Extract<PaymentEffect, { kind: "dispute" }>;
type DisputeRow = {
  payment_period_id: string; open: number; terminal: number; occurred_at: string;
};

function recordDispute(evidence: VerifiedEvidence, periodId: string,
  effect: DisputeEffect): void {
  const occurred = Date.parse(effect.occurredAt);
  if (!effect.disputeId || effect.disputeId.length > 200 || !Number.isFinite(occurred)) {
    throw new PaymentLifecycleError(400, "Invalid dispute evidence");
  }
  const occurredAt = new Date(occurred).toISOString();
  const prior = database.prepare(`SELECT payment_period_id, open, terminal, occurred_at
    FROM payment_disputes WHERE provider = ? AND mode = ? AND provider_dispute_id = ?`)
    .get(evidence.provider, evidence.mode, effect.disputeId) as DisputeRow | undefined;
  if (prior && prior.payment_period_id !== periodId) {
    throw new PaymentLifecycleError(409, "Dispute ID was already used for another paid period");
  }
  const rank = Number(effect.terminal) * 2 + Number(effect.open);
  const priorRank = prior ? prior.terminal * 2 + prior.open : -1;
  if (prior && (prior.terminal === 1 && !effect.terminal ||
      occurredAt < prior.occurred_at ||
      (occurredAt === prior.occurred_at && rank <= priorRank))) return;
  const recordedAt = new Date().toISOString();
  database.prepare(`INSERT INTO payment_disputes
    (provider, mode, provider_dispute_id, payment_period_id, open, terminal, occurred_at,
      closes_prior, recorded_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(provider, mode, provider_dispute_id) DO UPDATE SET
      open = excluded.open, terminal = excluded.terminal,
      occurred_at = excluded.occurred_at, closes_prior = excluded.closes_prior,
      recorded_at = excluded.recorded_at`).run(
    evidence.provider, evidence.mode, effect.disputeId, periodId, Number(effect.open),
    Number(effect.terminal), occurredAt, Number(effect.closesPrior === true), recordedAt,
  );
  if (effect.terminal && !effect.open) {
    database.prepare(`UPDATE payment_disputes SET open = 0, terminal = 1,
        occurred_at = ?, recorded_at = ?
      WHERE provider = ? AND mode = ? AND payment_period_id = ?
        AND provider_dispute_id LIKE 'legacy:%' AND occurred_at <= ?`).run(
      occurredAt, recordedAt, evidence.provider, evidence.mode, periodId, occurredAt,
    );
  }
}

function disputeOpenedAt(periodId: string): string | null {
  return (database.prepare(`SELECT MAX(d.occurred_at) AS occurred_at
    FROM payment_disputes d
    WHERE d.payment_period_id = ? AND d.open = 1
      AND NOT EXISTS (
        SELECT 1 FROM payment_disputes closed
        WHERE closed.payment_period_id = d.payment_period_id
          AND closed.closes_prior = 1
          AND closed.occurred_at >= d.occurred_at
      )`).get(periodId) as { occurred_at: string | null }).occurred_at;
}

function disputePeriod(evidence: VerifiedEvidence,
  effect: DisputeEffect): void {
  const period = matchingPeriod(evidence, effect.paymentId);
  recordDispute(evidence, period.id, effect);
  const occurredAt = disputeOpenedAt(period.id);
  const open = occurredAt !== null;
  const changed = database.prepare(`UPDATE payment_periods SET disputed_at = ? WHERE id = ?
    AND ${open ? "disputed_at IS NULL" : "disputed_at IS NOT NULL"}`).run(
    occurredAt, period.id);
  if (!changed.changes) return;
  refreshEntitlement(period.purchase_id);
  recordPurchaseNotification(period.purchase_id,
    open ? "payment.dispute-open" : "payment.dispute-closed",
    `payment:${evidence.provider}:${evidence.mode}:${evidence.eventId}:dispute`,
    open ? "Payment dispute opened" : "Payment dispute closed",
    open ? "A publishing payment is under dispute." : "The publishing payment dispute closed.");
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
  if (evidence.effect.kind === "checkout-terminal") terminalCheckout(evidence, evidence.effect);
  if (evidence.effect.kind === "subscription-linked") {
    const { purchaseId, resourceId, subscriptionId } = evidence.effect;
    if (!subscriptionId || subscriptionId.length > 200) {
      throw new PaymentLifecycleError(400, "Invalid provider subscription ID");
    }
    const purchase = database.prepare("SELECT * FROM purchases WHERE id = ?")
      .get(purchaseId) as Purchase | undefined;
    if (!purchase || purchase.provider !== evidence.provider || purchase.plan_mode !== evidence.mode ||
        purchase.checkout_terminal_state !== null ||
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

function nextEvidenceAttempt(attempts: number, now: number): string {
  const delay = Math.min(60 * 60_000, 60_000 * 2 ** Math.max(0, attempts - 1));
  return new Date(now + delay).toISOString();
}

export function retainVerifiedEvidence(evidence: VerifiedEvidence): { processed: boolean } {
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
    const current = database.prepare(`SELECT payload, state, attempts, quarantined_at
      FROM payment_evidence
      WHERE provider = ? AND mode = ? AND event_id = ?`)
      .get(evidence.provider, evidence.mode, evidence.eventId) as
        { payload: string; state: string; attempts: number; quarantined_at: string | null };
    if (current.payload !== payload) throw new PaymentLifecycleError(409, "Event ID has conflicting evidence");
    if (current.state === "processed") return { processed: true };
    const now = Date.now();
    if (current.quarantined_at || current.attempts >= 8) {
      return { processed: false };
    }
    try {
      database.transaction(() => applyEffect(evidence))();
      database.prepare(`UPDATE payment_evidence SET state = 'processed', attempts = attempts + 1,
        processed_at = ?, error = NULL, next_attempt_at = NULL, quarantined_at = NULL
        WHERE provider = ? AND mode = ? AND event_id = ?`).run(
        new Date(now).toISOString(), evidence.provider, evidence.mode, evidence.eventId,
      );
      return { processed: true };
    } catch (error) {
      const reason = error instanceof PaymentLifecycleError ? error.message : "Payment evidence processing failed";
      const attempts = current.attempts + 1;
      const quarantinedAt = attempts >= 8 ? new Date(now).toISOString() : null;
      const nextAttemptAt = quarantinedAt ? null : nextEvidenceAttempt(attempts, now);
      database.prepare(`UPDATE payment_evidence SET state = 'unresolved', attempts = attempts + 1,
        error = ?, next_attempt_at = ?, quarantined_at = ?
        WHERE provider = ? AND mode = ? AND event_id = ?`).run(
        reason, nextAttemptAt, quarantinedAt,
        evidence.provider, evidence.mode, evidence.eventId,
      );
      return { processed: false };
    }
  }).immediate();
}
