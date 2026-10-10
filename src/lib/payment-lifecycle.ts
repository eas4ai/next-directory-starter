import { randomUUID } from "node:crypto";
import { database } from "@/lib/database";
import { migrateCatalog } from "@/lib/catalog-migrations";
import { HttpError, httpErrorResponse } from "@/lib/http-error";
import type { BillingMode, BillingProvider } from "@/lib/billing-profiles";

migrateCatalog();

export class PaymentLifecycleError extends HttpError {}
export const paymentLifecycleErrorResponse = httpErrorResponse;

export type PaidEffect = {
  kind: "paid";
  purchaseId: string;
  resourceId: string;
  paymentId: string;
  subscriptionId?: string;
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
  status: string;
};

function paidPeriod(evidence: VerifiedEvidence, effect: PaidEffect): void {
  const purchase = database.prepare("SELECT * FROM purchases WHERE id = ?")
    .get(effect.purchaseId) as Purchase | undefined;
  if (!purchase || purchase.provider !== evidence.provider || purchase.plan_mode !== evidence.mode ||
      purchase.status === "refunded" || purchase.billing_mode === "free") {
    throw new PaymentLifecycleError(409, "Payment has no eligible matching purchase");
  }
  const resourceMatches = effect.resourceId === purchase.provider_resource_id;
  const subscriptionMatches = Boolean(effect.subscriptionId &&
    effect.subscriptionId === purchase.provider_subscription_id);
  if (!resourceMatches && !subscriptionMatches) {
    throw new PaymentLifecycleError(409, "Payment resource does not match the purchase");
  }
  if (purchase.provider_price_id !== (effect.priceId ?? null) ||
      effect.amountMinor !== purchase.amount_minor ||
      effect.currency.toLowerCase() !== purchase.currency ||
      !effect.paymentId || effect.paymentId.length > 200) {
    throw new PaymentLifecycleError(409, "Payment terms do not match the accepted purchase");
  }
  if (effect.subscriptionId && purchase.provider_subscription_id &&
      effect.subscriptionId !== purchase.provider_subscription_id) {
    throw new PaymentLifecycleError(409, "Payment subscription does not match the purchase");
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
        state = 'active', current_period_end = MAX(subscription_states.current_period_end,
          excluded.current_period_end), updated_at = excluded.updated_at`).run(
      purchase.id, effect.subscriptionId ?? null, endsAt, now.toISOString(),
    );
  }
}

function applyEffect(evidence: VerifiedEvidence): void {
  if (evidence.effect.kind === "paid") paidPeriod(evidence, evidence.effect);
  if (evidence.effect.kind === "subscription-linked") {
    const { purchaseId, resourceId, subscriptionId } = evidence.effect;
    if (!subscriptionId || subscriptionId.length > 200) {
      throw new PaymentLifecycleError(400, "Invalid provider subscription ID");
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
    const current = database.prepare(`SELECT payload, state, attempts FROM payment_evidence
      WHERE provider = ? AND mode = ? AND event_id = ?`)
      .get(evidence.provider, evidence.mode, evidence.eventId) as
        { payload: string; state: string; attempts: number };
    if (current.payload !== payload) throw new PaymentLifecycleError(409, "Event ID has conflicting evidence");
    if (current.state === "processed") return { processed: true };
    if (current.attempts >= 8) return { processed: false };
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
