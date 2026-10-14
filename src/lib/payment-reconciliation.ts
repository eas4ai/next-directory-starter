import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import { Environment, Paddle, type Transaction, type TransactionAdjustment } from "@paddle/paddle-node-sdk";
import { database } from "@/lib/database";
import { migrateCatalog } from "@/lib/catalog-migrations";
import { providerRecoveryConfiguration, type BillingMode, type BillingProvider } from "@/lib/billing-profiles";
import { nowPaymentsEffect } from "@/lib/payment-normalizers";
import { retainVerifiedEvidence, type VerifiedEvidence, type PaymentEffect } from "@/lib/payment-lifecycle";

migrateCatalog();

type Purchase = {
  id: string; provider: BillingProvider; plan_mode: BillingMode; billing_mode: string;
  provider_resource_id: string | null; provider_subscription_id: string | null;
  provider_price_id: string | null; amount_minor: number; currency: string;
  checkout_request_id: string | null; stripe_session_id: string;
  stripe_payment_intent_id: string | null; status: string;
};

type CursorUpdate = { stream: string; from: string | null; to: string | null };
export type ProviderInspection = {
  evidence: VerifiedEvidence[];
  cursorUpdates: CursorUpdate[];
};

function bound(limit: number): number {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
    throw new Error("Reconciliation limit must be between 1 and 50");
  }
  return limit;
}

export function retryRetainedEvidence(limit: number): {
  attempted: number; processed: number; unresolved: number; quarantined: number;
} {
  const now = new Date().toISOString();
  const rows = database.prepare(`SELECT provider, mode, event_id, event_type, payload
    FROM payment_evidence
    WHERE state = 'unresolved' AND attempts < 8 AND quarantined_at IS NULL
      AND COALESCE(next_attempt_at, received_at) <= ?
    ORDER BY COALESCE(next_attempt_at, received_at), received_at, event_id
    LIMIT ?`).all(now, bound(limit)) as
      (Omit<VerifiedEvidence, "raw" | "effect"> & { event_id: string;
        event_type: string; payload: string })[];
  let processed = 0;
  for (const row of rows) {
    const saved = JSON.parse(row.payload) as Pick<VerifiedEvidence, "raw" | "effect">;
    if (retainVerifiedEvidence({ provider: row.provider, mode: row.mode,
      eventId: row.event_id, eventType: row.event_type,
      raw: saved.raw, effect: saved.effect }).processed) processed += 1;
  }
  const quarantined = (database.prepare(`SELECT COUNT(*) AS count FROM payment_evidence
    WHERE state = 'unresolved' AND (quarantined_at IS NOT NULL OR attempts >= 8)`)
    .get() as { count: number }).count;
  return { attempted: rows.length, processed, unresolved: rows.length - processed, quarantined };
}

function evidence(purchase: Purchase, source: string, resource: string,
  effect: PaymentEffect): VerifiedEvidence {
  return { provider: purchase.provider, mode: purchase.plan_mode,
    eventId: `reconcile:${purchase.provider}:${source}:${resource}`,
    eventType: `reconcile.${source}`, raw: { purchaseId: purchase.id, resource }, effect };
}

function reconciliationCursor(purchaseId: string, stream: string): string | null {
  const row = database.prepare(`SELECT cursor FROM payment_reconciliation_cursors
    WHERE purchase_id = ? AND stream = ?`).get(purchaseId, stream) as
    { cursor: string } | undefined;
  return row?.cursor ?? null;
}

function evidencePayload(item: VerifiedEvidence): string {
  return JSON.stringify({ raw: item.raw, effect: item.effect });
}

function appendUnretained(target: VerifiedEvidence[], candidates: VerifiedEvidence[],
  limit: number): boolean {
  const selected = new Map(target.map((item) => [item.eventId, evidencePayload(item)]));
  const remaining: VerifiedEvidence[] = [];
  for (const item of candidates) {
    const payload = evidencePayload(item);
    const current = selected.get(item.eventId);
    if (current !== undefined) {
      if (current !== payload) {
        selected.set(item.eventId, payload);
        remaining.push(item);
      }
      continue;
    }
    const retained = database.prepare(`SELECT payload FROM payment_evidence
      WHERE provider = ? AND mode = ? AND event_id = ?`)
      .get(item.provider, item.mode, item.eventId) as { payload: string } | undefined;
    if (retained?.payload === payload) continue;
    selected.set(item.eventId, payload);
    remaining.push(item);
  }
  const available = Math.max(0, limit - target.length);
  target.push(...remaining.slice(0, available));
  return remaining.length <= available;
}

function saveCursorUpdates(purchaseId: string, updates: CursorUpdate[]): void {
  if (!updates.length) return;
  database.transaction(() => {
    const now = new Date().toISOString();
    for (const update of updates) {
      if (update.from === null) {
        if (update.to !== null) {
          database.prepare(`INSERT INTO payment_reconciliation_cursors
            (purchase_id, stream, cursor, updated_at) VALUES (?, ?, ?, ?)
            ON CONFLICT(purchase_id, stream) DO NOTHING`).run(
            purchaseId, update.stream, update.to, now,
          );
        }
      } else if (update.to === null) {
        database.prepare(`DELETE FROM payment_reconciliation_cursors
          WHERE purchase_id = ? AND stream = ? AND cursor = ?`).run(
          purchaseId, update.stream, update.from,
        );
      } else {
        database.prepare(`UPDATE payment_reconciliation_cursors
          SET cursor = ?, updated_at = ?
          WHERE purchase_id = ? AND stream = ? AND cursor = ?`).run(
          update.to, now, purchaseId, update.stream, update.from,
        );
      }
    }
  }).immediate();
}

async function stripeOutcomes(purchase: Purchase, stripe: Stripe,
  paymentIntentId: string): Promise<{ chargeId?: string; evidence: VerifiedEvidence[] }> {
  const found: VerifiedEvidence[] = [];
  const charges = await stripe.charges.list({ payment_intent: paymentIntentId, limit: 1 });
  const charge = charges.data[0];
  if (charge?.amount_refunded > 0) {
    found.push(evidence(purchase, "refund", `${charge.id}:${charge.amount_refunded}`, {
      kind: "refund", paymentId: paymentIntentId,
      full: charge.refunded && charge.amount_refunded >= charge.amount,
      amountMinor: charge.amount_refunded, currency: charge.currency,
    }));
  }
  const disputes = await stripe.disputes.list({ payment_intent: paymentIntentId, limit: 5 });
  for (const dispute of disputes.data.sort((a, b) => a.created - b.created)) {
    found.push(evidence(purchase, "dispute", `${dispute.id}:${dispute.status}`, {
      kind: "dispute", paymentId: paymentIntentId, disputeId: dispute.id,
      open: dispute.status !== "won", terminal: dispute.status === "won" || dispute.status === "lost",
      occurredAt: new Date(dispute.created * 1000).toISOString(),
    }));
  }
  return { chargeId: charge?.id, evidence: found };
}

async function stripeInvoiceAssociations(purchase: Purchase, stripe: Stripe,
  invoice: Stripe.Invoice): Promise<{ source: string; paymentIntentId?: string;
    chargeId?: string; evidence: VerifiedEvidence[] }> {
  const invoicePayments = invoice as unknown as {
    payments?: { data?: { payment?: { payment_intent?: string; charge?: string } }[] };
    payment_intent?: string;
    charge?: string;
  };
  const invoicePayment = invoicePayments.payments?.data?.[0]?.payment;
  const paymentIntentId = invoicePayments.payment_intent ?? invoicePayment?.payment_intent;
  const linked = paymentIntentId ? await stripeOutcomes(purchase, stripe, paymentIntentId) :
    { evidence: [] };
  const chargeId = linked.chargeId ?? invoicePayments.charge ?? invoicePayment?.charge;
  const names = [paymentIntentId && "payment-intent", chargeId && "charge"].filter(Boolean);
  return { source: names.length ? `invoice-${names.join("-")}` : "invoice",
    paymentIntentId, chargeId, evidence: linked.evidence };
}

async function stripeInvoiceEvidence(purchase: Purchase, stripe: Stripe,
  subscriptionId: string, invoice: Stripe.Invoice): Promise<VerifiedEvidence[]> {
  if (invoice.status !== "paid" || !invoice.currency || !invoice.amount_paid ||
      invoice.amount_paid < purchase.amount_minor || invoice.lines.data.length !== 1) return [];
  const line = invoice.lines.data[0];
  const legacy = (line as unknown as {
    price?: { id?: string; unit_amount?: number | null };
  }).price;
  const price = line.pricing?.type === "price_details"
    ? line.pricing.price_details?.price : legacy?.id;
  const unit = line.pricing?.type === "price_details" ? line.amount : legacy?.unit_amount;
  if (price !== purchase.provider_price_id || unit !== purchase.amount_minor ||
      !line.period?.start || !line.period?.end) return [];
  const associations = await stripeInvoiceAssociations(purchase, stripe, invoice);
  return [evidence(purchase, associations.source, invoice.id, {
    kind: "paid", purchaseId: purchase.id, resourceId: invoice.id,
    paymentId: invoice.id, subscriptionId,
    paymentIntentId: associations.paymentIntentId, chargeId: associations.chargeId,
    priceId: price ?? undefined, amountMinor: purchase.amount_minor,
    currency: invoice.currency,
    periodStart: new Date(line.period.start * 1000).toISOString(),
    periodEnd: new Date(line.period.end * 1000).toISOString(),
  }), ...associations.evidence];
}

function recoverableLegacyStripePurchase(purchase: Purchase, resourceId?: string): boolean {
  return Boolean(resourceId && /^cs_[0-9A-Za-z_.:-]{1,197}$/.test(resourceId) &&
    purchase.provider === "stripe" && purchase.billing_mode === "one-time" &&
    purchase.status === "paid" && purchase.provider_resource_id === null &&
    purchase.checkout_request_id && purchase.stripe_session_id === resourceId &&
    purchase.stripe_payment_intent_id &&
    /^pi_[0-9A-Za-z_.:-]{1,197}$/.test(purchase.stripe_payment_intent_id));
}

function adoptLegacyStripePeriod(purchase: Purchase, resourceId: string,
  found: VerifiedEvidence[]): void {
  const sessions = found.filter((item) => item.provider === "stripe" &&
    item.mode === purchase.plan_mode && item.eventType === "reconcile.session" &&
    item.effect.kind === "paid");
  if (sessions.length !== 1 || sessions[0].effect.kind !== "paid") {
    throw new Error("Legacy Stripe recovery needs one authoritative paid checkout");
  }
  const effect = sessions[0].effect;
  if (effect.purchaseId !== purchase.id || effect.resourceId !== resourceId ||
      effect.paymentId !== purchase.stripe_payment_intent_id ||
      (effect.priceId ?? null) !== purchase.provider_price_id || effect.subscriptionId ||
      effect.amountMinor !== purchase.amount_minor ||
      effect.currency.toLowerCase() !== purchase.currency) {
    throw new Error("Legacy Stripe checkout does not match the paid purchase");
  }
  database.transaction(() => {
    const current = database.prepare(`SELECT e.starts_at, e.ends_at, p.provider_resource_id,
        p.provider_price_id, p.amount_minor, p.currency
      FROM purchases p JOIN entitlements e ON e.purchase_id = p.id
      WHERE p.id = ? AND p.provider = 'stripe' AND p.plan_mode = ?
        AND p.billing_mode = 'one-time' AND p.status = 'paid'
        AND p.checkout_request_id IS NOT NULL AND p.checkout_request_id <> ''
        AND p.stripe_session_id = ?
        AND p.stripe_payment_intent_id = ?`).get(
      purchase.id, purchase.plan_mode, resourceId, effect.paymentId,
    ) as { starts_at: string; ends_at: string; provider_resource_id: string | null;
      provider_price_id: string | null; amount_minor: number; currency: string } | undefined;
    const startsAt = Date.parse(current?.starts_at ?? "");
    const endsAt = Date.parse(current?.ends_at ?? "");
    if (!current || !Number.isFinite(startsAt) || !Number.isFinite(endsAt) || endsAt <= startsAt ||
        (current.provider_resource_id !== null && current.provider_resource_id !== resourceId) ||
        current.provider_price_id !== (effect.priceId ?? null) ||
        current.amount_minor !== effect.amountMinor || current.currency !== effect.currency.toLowerCase()) {
      throw new Error("Legacy Stripe purchase has no recoverable entitlement");
    }
    const other = database.prepare(`SELECT 1 FROM payment_periods WHERE purchase_id = ?
      AND NOT (provider = 'stripe' AND provider_payment_id = ?) LIMIT 1`)
      .get(purchase.id, effect.paymentId);
    if (other) throw new Error("Legacy Stripe purchase already has a different paid period");
    database.prepare(`INSERT INTO payment_periods
      (id, purchase_id, provider, provider_payment_id, amount_minor, currency, starts_at, ends_at)
      VALUES (?, ?, 'stripe', ?, ?, ?, ?, ?)
      ON CONFLICT(provider, provider_payment_id) DO NOTHING`).run(
      randomUUID(), purchase.id, effect.paymentId, current.amount_minor,
      current.currency, current.starts_at, current.ends_at,
    );
    const period = database.prepare(`SELECT purchase_id, amount_minor, currency, starts_at, ends_at
      FROM payment_periods WHERE provider = 'stripe' AND provider_payment_id = ?`)
      .get(effect.paymentId) as { purchase_id: string; amount_minor: number; currency: string;
        starts_at: string; ends_at: string } | undefined;
    if (!period || period.purchase_id !== purchase.id || period.amount_minor !== current.amount_minor ||
        period.currency !== current.currency || period.starts_at !== current.starts_at ||
        period.ends_at !== current.ends_at) {
      throw new Error("Legacy Stripe payment is already bound to different access");
    }
    const updated = database.prepare(`UPDATE purchases SET provider_resource_id = ?
      WHERE id = ? AND provider = 'stripe' AND plan_mode = ? AND billing_mode = 'one-time'
        AND status = 'paid' AND provider_resource_id IS NULL
        AND stripe_session_id = ? AND stripe_payment_intent_id = ?`).run(
      resourceId, purchase.id, purchase.plan_mode, resourceId, effect.paymentId,
    );
    if (!updated.changes && current.provider_resource_id !== resourceId) {
      throw new Error("Legacy Stripe purchase changed during recovery");
    }
  }).immediate();
}

async function inspectStripe(purchase: Purchase, limit: number): Promise<ProviderInspection> {
  const config = providerRecoveryConfiguration("stripe", purchase.plan_mode);
  if (!config) throw new Error("Stripe recovery credentials are unavailable");
  const stripe = new Stripe(config.apiKey, { timeout: 15_000, maxNetworkRetries: 1,
    httpClient: Stripe.createFetchHttpClient() });
  const session = await stripe.checkout.sessions.retrieve(purchase.provider_resource_id!,
    { expand: ["line_items"] });
  if (session.id !== purchase.provider_resource_id || session.client_reference_id !== purchase.id) {
    throw new Error("Stripe checkout does not match the reserved purchase");
  }
  const line = session.line_items?.data;
  if (!line || line.length !== 1 || line[0].quantity !== 1 ||
      (purchase.provider_price_id && line[0].price?.id !== purchase.provider_price_id)) {
    throw new Error("Stripe checkout price does not match the reserved purchase");
  }
  const result: ProviderInspection = { evidence: [], cursorUpdates: [] };
  if (session.status === "expired") {
    appendUnretained(result.evidence, [evidence(purchase, "session-expired", session.id, {
      kind: "checkout-terminal", purchaseId: purchase.id, resourceId: session.id,
      state: "expired", occurredAt: new Date(session.expires_at * 1000).toISOString(),
    })], limit);
    return result;
  }
  if (purchase.billing_mode === "one-time" && session.payment_status === "paid" &&
      typeof session.payment_intent === "string" &&
      session.amount_total !== null && session.currency) {
    const linked = await stripeOutcomes(purchase, stripe, session.payment_intent);
    appendUnretained(result.evidence, [evidence(purchase, "session", session.id, {
      kind: "paid", purchaseId: purchase.id, resourceId: session.id,
      paymentId: session.payment_intent, paymentIntentId: session.payment_intent,
      chargeId: linked.chargeId,
      priceId: purchase.provider_price_id ?? undefined,
      amountMinor: session.amount_total, currency: session.currency,
    }), ...linked.evidence], limit);
    return result;
  }
  if ((purchase.billing_mode === "monthly" || purchase.billing_mode === "annual") &&
      typeof session.subscription === "string") {
    const linkComplete = appendUnretained(result.evidence, [evidence(
      purchase, "subscription-link", session.id, {
      kind: "subscription-linked", purchaseId: purchase.id, resourceId: session.id,
      subscriptionId: session.subscription,
    })], limit);
    if (!linkComplete || result.evidence.length >= limit) return result;

    const stream = "stripe:invoices";
    const from = reconciliationCursor(purchase.id, stream);
    const invoices = await stripe.invoices.list({ subscription: session.subscription, limit: 1,
      ...(from ? { starting_after: from } : {}) });
    const invoice = invoices.data[0];
    const candidates = invoice
      ? await stripeInvoiceEvidence(purchase, stripe, session.subscription, invoice) : [];
    if (appendUnretained(result.evidence, candidates, limit)) {
      result.cursorUpdates.push({ stream, from,
        to: invoice && invoices.has_more ? invoice.id : null });
  }
  }
  return result;
}

const paddleDisputeActions = new Set([
  "chargeback", "chargeback_warning", "chargeback_reverse", "chargeback_warning_reverse",
]);
const paddleReversalActions = new Set(["chargeback_reverse", "chargeback_warning_reverse"]);

function paddleAdjustmentEvidence(purchase: Purchase, paymentId: string,
  adjustment: TransactionAdjustment): VerifiedEvidence | null {
  if (adjustment.action === "refund" && adjustment.status === "approved") {
    const amountMinor = Number(adjustment.totals?.total);
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) return null;
    return evidence(purchase, "refund", `${adjustment.id}:${adjustment.status}`, {
      kind: "refund", paymentId, refundId: adjustment.id,
      full: adjustment.items.length === 1 && adjustment.items[0].type === "full",
      amountMinor, currency: adjustment.currencyCode,
    });
  }
  if (!paddleDisputeActions.has(adjustment.action)) return null;
  const reversal = paddleReversalActions.has(adjustment.action);
  const closed = reversal || adjustment.status === "reversed" || adjustment.status === "rejected";
  return evidence(purchase, "dispute", `${adjustment.id}:${adjustment.status}`, {
    kind: "dispute", paymentId, disputeId: adjustment.id,
    open: !closed, terminal: closed || adjustment.status === "approved",
    occurredAt: adjustment.updatedAt, closesPrior: reversal,
  });
}

function paddleTransactionEvidence(purchase: Purchase,
  transaction: Transaction): VerifiedEvidence[] {
  if (transaction.customData?.purchaseId !== purchase.id) {
    throw new Error("Paddle transaction does not match the reserved purchase");
  }
  const item = transaction.items.length === 1 ? transaction.items[0] : null;
  const amount = Number(item?.price?.unitPrice.amount);
  const paid = Number(transaction.details?.totals?.grandTotal);
  if (transaction.status !== "completed" || !item || item.quantity !== 1 ||
      item.price?.id !== purchase.provider_price_id ||
      !Number.isSafeInteger(amount) || amount !== purchase.amount_minor ||
      !Number.isSafeInteger(paid) || paid < amount) return [];
  const results = [evidence(purchase, "transaction", transaction.id, {
    kind: "paid", purchaseId: purchase.id, resourceId: transaction.id,
    paymentId: transaction.id, subscriptionId: transaction.subscriptionId ?? undefined,
    priceId: item.price.id, amountMinor: amount,
    currency: transaction.currencyCode,
    periodStart: transaction.billingPeriod?.startsAt,
    periodEnd: transaction.billingPeriod?.endsAt,
  })];
  for (const adjustment of transaction.adjustments ?? []) {
    const outcome = paddleAdjustmentEvidence(purchase, transaction.id, adjustment);
    if (outcome) results.push(outcome);
  }
  return results;
}

async function inspectPaddle(purchase: Purchase, limit: number): Promise<ProviderInspection> {
  const config = providerRecoveryConfiguration("paddle", purchase.plan_mode);
  if (!config) throw new Error("Paddle recovery credentials are unavailable");
  const paddle = new Paddle(config.apiKey, {
    environment: purchase.plan_mode === "test" ? Environment.sandbox : Environment.production,
  });
  const first = await paddle.transactions.get(purchase.provider_resource_id!,
    { include: ["adjustment"] });
  if (first.id !== purchase.provider_resource_id) throw new Error("Paddle transaction changed");
  const result: ProviderInspection = { evidence: [], cursorUpdates: [] };
  const firstComplete = appendUnretained(result.evidence,
    paddleTransactionEvidence(purchase, first), limit);
  if (!firstComplete || result.evidence.length >= limit) return result;

  const subscriptionId = purchase.provider_subscription_id ?? first.subscriptionId;
  if (subscriptionId && purchase.billing_mode !== "one-time") {
    const stream = "paddle:transactions";
    const from = reconciliationCursor(purchase.id, stream);
    const collection = paddle.transactions.list({ subscriptionId: [subscriptionId],
      status: ["completed"], include: ["adjustment"],
      perPage: 1, orderBy: "created_at[DESC]", ...(from ? { after: from } : {}) });
    const page = await collection.next();
    const transaction = page[0];
    const candidates = transaction ? paddleTransactionEvidence(purchase, transaction) : [];
    if (appendUnretained(result.evidence, candidates, limit)) {
      result.cursorUpdates.push({ stream, from,
        to: transaction && collection.hasMore ? transaction.id : null });
    }
  }
  return result;
}

async function inspectNowPayments(purchase: Purchase, limit: number): Promise<ProviderInspection> {
  const config = providerRecoveryConfiguration("nowpayments", purchase.plan_mode);
  if (!config) throw new Error("NOWPayments recovery credentials are unavailable");
  const email = process.env.NOWPAYMENTS_EMAIL;
  const password = process.env.NOWPAYMENTS_PASSWORD;
  if (!email || !password) {
    throw new Error("NOWPAYMENTS_EMAIL and NOWPAYMENTS_PASSWORD are needed to list invoice payments");
  }
  const { NowPaymentsSDK } = await import("@nowpaymentsio/nowpayments-sdk-nodejs");
  const sdk = new NowPaymentsSDK({ apiKey: config.apiKey, email, password,
    baseUrl: purchase.plan_mode === "test" ? "https://api-sandbox.nowpayments.io" :
      "https://api.nowpayments.io", timeoutMs: 15_000 });
  const stream = "nowpayments:payments";
  const from = reconciliationCursor(purchase.id, stream);
  const pageNumber = from === null ? 0 : Number(from);
  if (!Number.isSafeInteger(pageNumber) || pageNumber < 0) {
    throw new Error("NOWPayments reconciliation cursor is invalid");
  }
  const page = await sdk.listPayments({ invoiceId: purchase.provider_resource_id!,
    limit: 1, page: pageNumber, sortBy: "created_at", orderBy: "desc" });
  const candidates = page.data.flatMap((payment) => {
    if (payment.invoice_id !== purchase.provider_resource_id ||
        payment.order_id !== purchase.id || !payment.payment_id) return [];
    const effect = nowPaymentsEffect(payment);
    return effect.kind === "noop" ? [] : [evidence(purchase,
      `payment-${payment.payment_status}`, payment.payment_id, effect)];
  });
  const result: ProviderInspection = { evidence: [], cursorUpdates: [] };
  if (appendUnretained(result.evidence, candidates, limit)) {
    const hasMore = page.pagesCount !== null
      ? pageNumber + 1 < page.pagesCount
      : page.total !== null && Number.isSafeInteger(page.total)
        ? pageNumber + page.data.length < page.total : page.data.length === 1;
    result.cursorUpdates.push({ stream, from, to: hasMore ? String(pageNumber + 1) : null });
  }
  return result;
}

export type ProviderInspector = (purchase: Purchase, limit: number) =>
  Promise<VerifiedEvidence[] | ProviderInspection>;
const inspectProvider: ProviderInspector = (purchase, limit) => purchase.provider === "stripe"
  ? inspectStripe(purchase, limit) : purchase.provider === "paddle"
    ? inspectPaddle(purchase, limit) : inspectNowPayments(purchase, limit);

function normalizeInspection(value: VerifiedEvidence[] | ProviderInspection): ProviderInspection {
  return Array.isArray(value) ? { evidence: value, cursorUpdates: [] } : value;
}

export async function reconcilePurchase(purchaseId: string, limit: number,
  inspect: ProviderInspector = inspectProvider, resourceId?: string): Promise<{
    purchaseId: string; found: number; processed: number; unresolved: number;
  }> {
  bound(limit);
  const purchase = database.prepare(`SELECT id, provider, plan_mode, billing_mode,
      provider_resource_id, provider_subscription_id, provider_price_id, amount_minor, currency,
      checkout_request_id, stripe_session_id, stripe_payment_intent_id, status
    FROM purchases WHERE id = ?`).get(purchaseId) as Purchase | undefined;
  if (!purchase) throw new Error("Hosted purchase not found");
  if (resourceId && (!/^[0-9A-Za-z_.:-]{1,200}$/.test(resourceId) ||
      purchase.provider_resource_id && resourceId !== purchase.provider_resource_id)) {
    throw new Error("Recovery resource does not match the purchase");
  }
  const legacyStripe = recoverableLegacyStripePurchase(purchase, resourceId);
  if (!purchase.provider_resource_id && !legacyStripe && (!resourceId ||
      purchase.status !== "pending" || !purchase.checkout_request_id ||
      purchase.stripe_session_id !== `pending:${purchase.id}`)) {
    throw new Error("Resource-less checkout needs its provider resource ID for bounded recovery");
  }
  const inspection = normalizeInspection(await inspect({ ...purchase,
    provider_resource_id: purchase.provider_resource_id ?? resourceId! }, limit));
  const found = inspection.evidence;
  if (found.length > limit) throw new Error("Provider inspection exceeded the requested limit");
  if (inspection.cursorUpdates.length > 3 || inspection.cursorUpdates.some((update) =>
    !/^[a-z0-9:-]{1,100}$/.test(update.stream) ||
    update.from !== null && update.from.length > 200 ||
    update.to !== null && update.to.length > 200)) {
    throw new Error("Provider inspection returned an invalid cursor update");
  }
  for (const item of found) {
    if (item.provider !== purchase.provider || item.mode !== purchase.plan_mode) {
      throw new Error("Provider inspection returned a different payment mode");
    }
    if ("purchaseId" in item.effect && item.effect.purchaseId !== purchase.id) {
      throw new Error("Provider inspection returned a different purchase");
    }
  }
  if (legacyStripe) adoptLegacyStripePeriod(purchase, resourceId!, found);
  let processed = 0;
  for (const item of found) {
    if (item.effect.kind === "refund" || item.effect.kind === "dispute") {
      const linked = database.prepare(`SELECT purchase_id FROM payment_periods
        WHERE provider = ? AND (provider_payment_id = ? OR provider_payment_intent_id = ?
          OR provider_charge_id = ?)
        LIMIT 1`).get(purchase.provider, item.effect.paymentId,
        item.effect.paymentId, item.effect.paymentId) as { purchase_id: string } | undefined;
      if (linked && linked.purchase_id !== purchase.id) {
        throw new Error("Provider outcome belongs to a different purchase");
      }
    }
    if (retainVerifiedEvidence(item).processed) processed += 1;
  }
  saveCursorUpdates(purchase.id, inspection.cursorUpdates);
  return { purchaseId, found: found.length, processed, unresolved: found.length - processed };
}

export async function reconcileBilling(limit: number, purchaseId: string | null = null,
  resourceId?: string, inspect: ProviderInspector = inspectProvider): Promise<{
    retained: ReturnType<typeof retryRetainedEvidence>;
    purchase: Awaited<ReturnType<typeof reconcilePurchase>> | null;
    purchaseDeferred: boolean;
  }> {
  const budget = bound(limit);
  const retained = retryRetainedEvidence(budget);
  const remaining = budget - retained.attempted;
  const purchaseDeferred = purchaseId !== null && remaining === 0;
  const purchase = purchaseId !== null && remaining > 0
    ? await reconcilePurchase(purchaseId, remaining, inspect, resourceId) : null;
  return { retained, purchase, purchaseDeferred };
}
