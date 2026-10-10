import Stripe from "stripe";
import { Environment, Paddle } from "@paddle/paddle-node-sdk";
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
};

function bound(limit: number): number {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
    throw new Error("Reconciliation limit must be between 1 and 50");
  }
  return limit;
}

export function retryRetainedEvidence(limit: number): {
  attempted: number; processed: number; unresolved: number;
} {
  const rows = database.prepare(`SELECT provider, mode, event_id, event_type, payload
    FROM payment_evidence WHERE state = 'unresolved'
    ORDER BY received_at, event_id LIMIT ?`).all(bound(limit)) as
      (Omit<VerifiedEvidence, "raw" | "effect"> & { event_id: string;
        event_type: string; payload: string })[];
  let processed = 0;
  for (const row of rows) {
    const saved = JSON.parse(row.payload) as Pick<VerifiedEvidence, "raw" | "effect">;
    if (retainVerifiedEvidence({ provider: row.provider, mode: row.mode,
      eventId: row.event_id, eventType: row.event_type,
      raw: saved.raw, effect: saved.effect }, { retryExhausted: true }).processed) processed += 1;
  }
  return { attempted: rows.length, processed, unresolved: rows.length - processed };
}

function evidence(purchase: Purchase, source: string, resource: string,
  effect: PaymentEffect): VerifiedEvidence {
  return { provider: purchase.provider, mode: purchase.plan_mode,
    eventId: `reconcile:${purchase.provider}:${source}:${resource}`,
    eventType: `reconcile.${source}`, raw: { purchaseId: purchase.id, resource }, effect };
}

async function inspectStripe(purchase: Purchase, limit: number): Promise<VerifiedEvidence[]> {
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
  const results: VerifiedEvidence[] = [];
  const outcomes = async (paymentIntentId: string) => {
    const charges = await stripe.charges.list({ payment_intent: paymentIntentId, limit: 1 });
    const charge = charges.data[0];
    if (charge?.amount_refunded > 0) {
      results.push(evidence(purchase, "refund", `${charge.id}:${charge.amount_refunded}`, {
        kind: "refund", paymentId: paymentIntentId,
        full: charge.refunded && charge.amount_refunded >= charge.amount,
        amountMinor: charge.amount_refunded, currency: charge.currency,
      }));
    }
    const disputes = await stripe.disputes.list({ payment_intent: paymentIntentId, limit: 5 });
    for (const dispute of disputes.data.sort((a, b) => a.created - b.created)) {
      results.push(evidence(purchase, "dispute", `${dispute.id}:${dispute.status}`, {
        kind: "dispute", paymentId: paymentIntentId, open: dispute.status !== "won",
      }));
    }
  };
  if (purchase.billing_mode === "one-time" && session.payment_status === "paid" &&
      typeof session.payment_intent === "string" &&
      session.amount_total !== null && session.currency) {
    results.push(evidence(purchase, "session", session.id, {
      kind: "paid", purchaseId: purchase.id, resourceId: session.id,
      paymentId: session.payment_intent,
      priceId: purchase.provider_price_id ?? undefined,
      amountMinor: session.amount_total, currency: session.currency,
    }));
    await outcomes(session.payment_intent);
  }
  if ((purchase.billing_mode === "monthly" || purchase.billing_mode === "annual") &&
      typeof session.subscription === "string") {
    results.push(evidence(purchase, "subscription-link", session.id, {
      kind: "subscription-linked", purchaseId: purchase.id, resourceId: session.id,
      subscriptionId: session.subscription,
    }));
    const invoices = await stripe.invoices.list({ subscription: session.subscription,
      limit: Math.min(limit, 10) });
    for (const invoice of invoices.data.reverse()) {
      if (invoice.status !== "paid" || !invoice.id || !invoice.currency ||
          !invoice.amount_paid || invoice.amount_paid < purchase.amount_minor ||
          invoice.lines.data.length !== 1) continue;
      const line = invoice.lines.data[0];
      const legacy = (line as unknown as {
        price?: { id?: string; unit_amount?: number | null };
      }).price;
      const price = line.pricing?.type === "price_details" ? line.pricing.price_details?.price :
        legacy?.id;
      const unit = line.pricing?.type === "price_details" ? line.amount : legacy?.unit_amount;
      if (price !== purchase.provider_price_id || unit !== purchase.amount_minor ||
          !line.period?.start || !line.period?.end) continue;
      results.push(evidence(purchase, "invoice", invoice.id, {
        kind: "paid", purchaseId: purchase.id, resourceId: invoice.id,
        paymentId: invoice.id, subscriptionId: session.subscription,
        priceId: price ?? undefined, amountMinor: purchase.amount_minor,
        currency: invoice.currency,
        periodStart: new Date(line.period.start * 1000).toISOString(),
        periodEnd: new Date(line.period.end * 1000).toISOString(),
      }));
      const invoicePayments = (invoice as unknown as {
        payments?: { data?: { payment?: { payment_intent?: string } }[] };
        payment_intent?: string;
      });
      const paymentIntentId = invoicePayments.payment_intent ??
        invoicePayments.payments?.data?.[0]?.payment?.payment_intent;
      if (paymentIntentId) await outcomes(paymentIntentId);
    }
  }
  return results;
}

async function inspectPaddle(purchase: Purchase, limit: number): Promise<VerifiedEvidence[]> {
  const config = providerRecoveryConfiguration("paddle", purchase.plan_mode);
  if (!config) throw new Error("Paddle recovery credentials are unavailable");
  const paddle = new Paddle(config.apiKey, {
    environment: purchase.plan_mode === "test" ? Environment.sandbox : Environment.production,
  });
  const first = await paddle.transactions.get(purchase.provider_resource_id!,
    { include: ["adjustment"] });
  if (first.id !== purchase.provider_resource_id) throw new Error("Paddle transaction changed");
  const transactions = [first];
  const subscriptionId = purchase.provider_subscription_id ?? first.subscriptionId;
  if (subscriptionId && purchase.billing_mode !== "one-time") {
    const page = await paddle.transactions.list({ subscriptionId: [subscriptionId],
      status: ["completed"], include: ["adjustment"],
      perPage: Math.min(limit, 10) }).next();
    for (const item of page) if (item.id !== first.id) transactions.push(item);
  }
  return transactions.sort((a, b) => a.createdAt.localeCompare(b.createdAt)).flatMap((transaction) => {
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
      if (adjustment.action === "refund" && adjustment.status === "approved") {
        const amountMinor = Number(adjustment.totals?.total);
        if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) continue;
        results.push(evidence(purchase, "refund", `${adjustment.id}:${adjustment.status}`, {
          kind: "refund", paymentId: transaction.id,
          full: adjustment.items.length === 1 && adjustment.items[0].type === "full",
          amountMinor, currency: adjustment.currencyCode,
        }));
      }
      if (adjustment.action === "chargeback" ||
          adjustment.action === "chargeback_warning" ||
          adjustment.action === "chargeback_reverse") {
        results.push(evidence(purchase, "dispute", `${adjustment.id}:${adjustment.status}`, {
          kind: "dispute", paymentId: transaction.id,
          open: adjustment.action !== "chargeback_reverse" && adjustment.status !== "reversed",
        }));
      }
    }
    return results;
  });
}

async function inspectNowPayments(purchase: Purchase, limit: number): Promise<VerifiedEvidence[]> {
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
  const page = await sdk.listPayments({ invoiceId: purchase.provider_resource_id!,
    limit: Math.min(limit, 50), page: 0 });
  return page.data.flatMap((payment) => {
    if (payment.invoice_id !== purchase.provider_resource_id ||
        payment.order_id !== purchase.id || !payment.payment_id) return [];
    const effect = nowPaymentsEffect(payment);
    return effect.kind === "noop" ? [] : [evidence(purchase,
      `payment-${payment.payment_status}`, payment.payment_id, effect)];
  });
}

export type ProviderInspector = (purchase: Purchase, limit: number) => Promise<VerifiedEvidence[]>;
const inspectProvider: ProviderInspector = (purchase, limit) => purchase.provider === "stripe"
  ? inspectStripe(purchase, limit) : purchase.provider === "paddle"
    ? inspectPaddle(purchase, limit) : inspectNowPayments(purchase, limit);

export async function reconcilePurchase(purchaseId: string, limit: number,
  inspect: ProviderInspector = inspectProvider): Promise<{
    purchaseId: string; found: number; processed: number; unresolved: number;
  }> {
  bound(limit);
  const purchase = database.prepare(`SELECT id, provider, plan_mode, billing_mode,
      provider_resource_id, provider_subscription_id, provider_price_id, amount_minor, currency
    FROM purchases WHERE id = ?`).get(purchaseId) as Purchase | undefined;
  if (!purchase || !purchase.provider_resource_id) throw new Error("Hosted purchase not found");
  const found = await inspect(purchase, limit);
  if (found.length > limit) throw new Error("Provider inspection exceeded the requested limit");
  let processed = 0;
  for (const item of found) {
    if (item.provider !== purchase.provider || item.mode !== purchase.plan_mode) {
      throw new Error("Provider inspection returned a different payment mode");
    }
    if ("purchaseId" in item.effect && item.effect.purchaseId !== purchase.id) {
      throw new Error("Provider inspection returned a different purchase");
    }
    if (item.effect.kind === "refund" || item.effect.kind === "dispute") {
      const linked = database.prepare(`SELECT purchase_id FROM payment_periods
        WHERE provider = ? AND (provider_payment_id = ? OR provider_charge_id = ?)
        LIMIT 1`).get(purchase.provider, item.effect.paymentId,
        item.effect.paymentId) as { purchase_id: string } | undefined;
      if (linked && linked.purchase_id !== purchase.id) {
        throw new Error("Provider outcome belongs to a different purchase");
      }
    }
    if (retainVerifiedEvidence(item, { retryExhausted: true }).processed) processed += 1;
  }
  return { purchaseId, found: found.length, processed, unresolved: found.length - processed };
}
