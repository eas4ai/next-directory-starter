import type Stripe from "stripe";
import { database } from "@/lib/database";
import type { PaymentEffect } from "@/lib/payment-lifecycle";

type Data = Record<string, unknown>;
const object = (value: unknown): Data | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Data : null;
const string = (value: unknown): string | null => typeof value === "string" && value ? value : null;
const number = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) ? value : null;
const date = (value: unknown): string | undefined => {
  const seconds = number(value);
  return seconds === null ? undefined : new Date(seconds * 1000).toISOString();
};

export function stripeEffect(event: Stripe.Event): PaymentEffect {
  const data = object(event.data?.object);
  if (!data) return { kind: "noop" };
  if (event.type === "charge.refunded" && data.object === "charge") {
    const paymentId = string(data.payment_intent);
    const amountMinor = number(data.amount_refunded);
    const original = number(data.amount);
    const currency = string(data.currency);
    return paymentId && amountMinor !== null && original !== null && currency
      ? { kind: "refund", paymentId, full: data.refunded === true && amountMinor >= original,
        amountMinor, currency } : { kind: "noop" };
  }
  if (event.type === "charge.dispute.created" || event.type === "charge.dispute.updated" ||
      event.type === "charge.dispute.closed") {
    const paymentId = string(data.payment_intent) ?? string(data.charge);
    const disputeId = string(data.id);
    const status = string(data.status);
    const occurredAt = date(event.created);
    return paymentId && disputeId && status && occurredAt
      ? { kind: "dispute", paymentId, disputeId, open: status !== "won",
        terminal: event.type === "charge.dispute.closed" || status === "won" || status === "lost",
        occurredAt }
      : { kind: "noop" };
  }
  if (event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted") {
    const subscriptionId = string(data.id);
    const metadata = object(data.metadata);
    const linked = subscriptionId ? database.prepare(`SELECT id FROM purchases
      WHERE provider = 'stripe' AND provider_subscription_id = ?`)
      .get(subscriptionId) as { id: string } | undefined : undefined;
    const purchaseId = string(metadata?.purchaseId) ?? linked?.id;
    const state = event.type === "customer.subscription.deleted" || data.status === "canceled"
      ? "canceled" : data.cancel_at_period_end === true ? "cancel-scheduled" :
        data.status === "active" ? "active" : null;
    return purchaseId && subscriptionId && state
      ? { kind: "subscription-state", purchaseId, subscriptionId, state,
        occurredAt: new Date(event.created * 1000).toISOString() } : { kind: "noop" };
  }
  if (event.type === "checkout.session.expired" && data.object === "checkout.session") {
    const metadata = object(data.metadata);
    const purchaseId = string(data.client_reference_id) ?? string(metadata?.purchaseId);
    const resourceId = string(data.id);
    const occurredAt = date(event.created);
    return purchaseId && resourceId && occurredAt
      ? { kind: "checkout-terminal", purchaseId, resourceId,
        state: "expired", occurredAt }
      : { kind: "noop" };
  }
  if (event.type === "checkout.session.completed" ||
      event.type === "checkout.session.async_payment_succeeded") {
    const purchaseId = string(data.client_reference_id);
    const resourceId = string(data.id);
    if (!purchaseId || !resourceId || data.object !== "checkout.session") return { kind: "noop" };
    if (data.mode === "subscription") {
      const subscriptionId = string(data.subscription);
      return subscriptionId ? { kind: "subscription-linked", purchaseId, resourceId, subscriptionId } :
        { kind: "noop" };
    }
    if (data.mode !== "payment" || data.payment_status !== "paid") return { kind: "noop" };
    const paymentId = string(data.payment_intent);
    const amountMinor = number(data.amount_total);
    const currency = string(data.currency);
    const metadata = object(data.metadata);
    if (!paymentId || amountMinor === null || !currency) return { kind: "noop" };
    return { kind: "paid", purchaseId, resourceId, paymentId, amountMinor, currency,
      priceId: string(metadata?.providerPriceId) ?? undefined };
  }
  if (event.type !== "invoice.paid" || data.object !== "invoice" ||
      data.status !== "paid" || !number(data.amount_paid)) return { kind: "noop" };
  const parent = object(data.parent);
  const subscriptionDetails = object(parent?.subscription_details);
  const subscriptionId = string(data.subscription) ?? string(subscriptionDetails?.subscription);
  const metadata = object(data.metadata);
  const subscriptionMetadata = object(subscriptionDetails?.metadata);
  const previous = subscriptionId ? database.prepare(`SELECT id FROM purchases
    WHERE provider = 'stripe' AND provider_subscription_id = ?`).get(subscriptionId) as
      { id: string } | undefined : undefined;
  const purchaseId = string(metadata?.purchaseId) ?? string(subscriptionMetadata?.purchaseId) ?? previous?.id;
  const lines = object(data.lines);
  const first = Array.isArray(lines?.data) && lines.data.length === 1
    ? object(lines.data[0]) : null;
  const price = object(first?.price);
  const pricing = object(first?.pricing);
  const priceDetails = object(pricing?.price_details);
  const period = object(first?.period);
  const amountMinor = number(price?.unit_amount) ?? number(first?.amount);
  const paidAmount = number(data.amount_paid);
  const priceId = string(price?.id) ?? string(priceDetails?.price);
  const currency = string(first?.currency) ?? string(data.currency);
  const paymentId = string(data.id);
  const payments = object(data.payments);
  const firstPayment = Array.isArray(payments?.data) ? object(payments.data[0]) : null;
  const payment = object(firstPayment?.payment);
  const paymentIntentId = string(data.payment_intent) ?? string(payment?.payment_intent);
  const chargeId = string(data.charge) ?? string(payment?.charge);
  if (!purchaseId || !subscriptionId || !paymentId || !priceId ||
      amountMinor === null || paidAmount === null || paidAmount < amountMinor ||
      !currency || !first ||
      (first.quantity !== undefined && first.quantity !== 1) ||
      amountMinor <= 0) return { kind: "noop" };
  return { kind: "paid", purchaseId, resourceId: paymentId, paymentId,
    subscriptionId, priceId, amountMinor, currency,
    paymentIntentId: paymentIntentId ?? undefined, chargeId: chargeId ?? undefined,
    periodStart: date(period?.start), periodEnd: date(period?.end) };
}

export function paddleEffect(payload: unknown): PaymentEffect {
  const envelope = object(payload);
  const eventType = string(envelope?.event_type);
  if (eventType === "adjustment.created" || eventType === "adjustment.updated") {
    const data = object(envelope?.data);
    const paymentId = string(data?.transaction_id);
    if (!paymentId) return { kind: "noop" };
    if (data?.action === "chargeback" || data?.action === "chargeback_warning" ||
        data?.action === "chargeback_reverse" || data?.action === "chargeback_warning_reverse") {
      const disputeId = string(data.id);
      const occurredAt = string(envelope?.occurred_at);
      const status = string(data.status);
      const reversal = data.action === "chargeback_reverse" ||
        data.action === "chargeback_warning_reverse";
      const closed = reversal || status === "reversed" || status === "rejected";
      return disputeId && occurredAt && status
        ? { kind: "dispute", paymentId, disputeId, open: !closed,
          terminal: closed || status === "approved", occurredAt,
          closesPrior: reversal }
        : { kind: "noop" };
    }
    const totals = object(data?.totals);
    const amount = string(totals?.total);
    const amountMinor = amount && /^\d+$/.test(amount) ? Number(amount) : null;
    const currency = string(data?.currency_code);
    const refundId = string(data?.id);
    return data?.action === "refund" && data.status === "approved" &&
      amountMinor !== null && Number.isSafeInteger(amountMinor) && currency && refundId
      ? { kind: "refund", paymentId, refundId,
        full: data.type === "full", amountMinor, currency }
      : { kind: "noop" };
  }
  if (eventType === "subscription.updated" || eventType === "subscription.canceled") {
    const data = object(envelope?.data);
    const subscriptionId = string(data?.id);
    const scheduled = object(data?.scheduled_change);
    const metadata = object(data?.custom_data);
    const linked = subscriptionId ? database.prepare(`SELECT id FROM purchases
      WHERE provider = 'paddle' AND provider_subscription_id = ?`)
      .get(subscriptionId) as { id: string } | undefined : undefined;
    const purchaseId = string(metadata?.purchaseId) ?? linked?.id;
    const state = eventType === "subscription.canceled" || data?.status === "canceled"
      ? "canceled" : scheduled?.action === "cancel" ? "cancel-scheduled" :
        data?.status === "active" ? "active" : null;
    return purchaseId && subscriptionId && state && string(envelope?.occurred_at)
      ? { kind: "subscription-state", purchaseId, subscriptionId, state,
        occurredAt: string(envelope?.occurred_at)! } : { kind: "noop" };
  }
  if (eventType !== "transaction.completed") return { kind: "noop" };
  const data = object(envelope?.data);
  if (!data || data.status !== "completed") return { kind: "noop" };
  const metadata = object(data.custom_data);
  const items = Array.isArray(data.items) ? data.items : [];
  const item = items.length === 1 ? object(items[0]) : null;
  const price = object(item?.price);
  const unitPrice = object(price?.unit_price);
  const details = object(data.details);
  const totals = object(details?.totals);
  const billingPeriod = object(data.billing_period);
  const amountMinor = typeof unitPrice?.amount === "string" && /^\d+$/.test(unitPrice.amount)
    ? Number(unitPrice.amount) : null;
  const paidTotal = typeof totals?.grand_total === "string" && /^\d+$/.test(totals.grand_total)
    ? Number(totals.grand_total) : null;
  const subscriptionId = string(data.subscription_id);
  const linked = subscriptionId ? database.prepare(`SELECT id FROM purchases
    WHERE provider = 'paddle' AND provider_subscription_id = ?`)
    .get(subscriptionId) as { id: string } | undefined : undefined;
  const purchaseId = string(metadata?.purchaseId) ?? linked?.id;
  const resourceId = string(data.id);
  const priceId = string(price?.id);
  const currency = string(data.currency_code);
  if (!purchaseId || !resourceId || !priceId || !currency ||
      !Number.isSafeInteger(amountMinor) || !Number.isSafeInteger(paidTotal) ||
      paidTotal! < amountMinor! ||
      item?.quantity !== 1) return { kind: "noop" };
  return { kind: "paid", purchaseId, resourceId, paymentId: resourceId,
    subscriptionId: subscriptionId ?? undefined,
    priceId, amountMinor: amountMinor!, currency,
    periodStart: string(billingPeriod?.starts_at) ?? undefined,
    periodEnd: string(billingPeriod?.ends_at) ?? undefined };
}

export function nowPaymentsEffect(payment: unknown): PaymentEffect {
  const data = object(payment);
  if (!data || (data.payment_status !== "finished" && data.payment_status !== "refunded")) {
    return { kind: "noop" };
  }
  const purchaseId = string(data.order_id);
  const resourceId = string(data.invoice_id);
  const paymentId = string(data.payment_id);
  const currency = string(data.price_currency);
  const amount = data.price_amount;
  if (!purchaseId || !resourceId || !paymentId || !currency ||
      typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0 ||
      !Number.isSafeInteger(Math.round(amount * 100)) ||
      Math.abs(amount * 100 - Math.round(amount * 100)) > 0.00001) return { kind: "noop" };
  return data.payment_status === "refunded"
    ? { kind: "refund", paymentId, full: true,
      amountMinor: Math.round(amount * 100), currency }
    : { kind: "paid", purchaseId, resourceId, paymentId,
      amountMinor: Math.round(amount * 100), currency };
}
