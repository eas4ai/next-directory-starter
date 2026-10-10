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
  const first = Array.isArray(lines?.data) ? object(lines.data[0]) : null;
  const price = object(first?.price);
  const pricing = object(first?.pricing);
  const priceDetails = object(pricing?.price_details);
  const period = object(first?.period);
  const amountMinor = number(price?.unit_amount) ?? number(first?.amount);
  const priceId = string(price?.id) ?? string(priceDetails?.price);
  const currency = string(first?.currency) ?? string(data.currency);
  const paymentId = string(data.id);
  if (!purchaseId || !subscriptionId || !paymentId || !priceId ||
      amountMinor === null || !currency) return { kind: "noop" };
  return { kind: "paid", purchaseId, resourceId: paymentId, paymentId,
    subscriptionId, priceId, amountMinor, currency,
    periodStart: date(period?.start), periodEnd: date(period?.end) };
}

export function paddleEffect(payload: unknown): PaymentEffect {
  const envelope = object(payload);
  if (envelope?.event_type !== "transaction.completed") return { kind: "noop" };
  const data = object(envelope.data);
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
  const purchaseId = string(metadata?.purchaseId);
  const resourceId = string(data.id);
  const priceId = string(price?.id);
  const currency = string(data.currency_code);
  if (!purchaseId || !resourceId || !priceId || !currency ||
      !Number.isSafeInteger(amountMinor) || !Number.isSafeInteger(paidTotal) || paidTotal! <= 0 ||
      item?.quantity !== 1) return { kind: "noop" };
  return { kind: "paid", purchaseId, resourceId, paymentId: resourceId,
    subscriptionId: string(data.subscription_id) ?? undefined,
    priceId, amountMinor: amountMinor!, currency,
    periodStart: string(billingPeriod?.starts_at) ?? undefined,
    periodEnd: string(billingPeriod?.ends_at) ?? undefined };
}

export function nowPaymentsEffect(payment: unknown): PaymentEffect {
  const data = object(payment);
  if (!data || data.payment_status !== "finished") return { kind: "noop" };
  const purchaseId = string(data.order_id);
  const resourceId = string(data.invoice_id);
  const paymentId = string(data.payment_id);
  const currency = string(data.price_currency);
  const amount = data.price_amount;
  if (!purchaseId || !resourceId || !paymentId || !currency ||
      typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0 ||
      !Number.isSafeInteger(Math.round(amount * 100)) ||
      Math.abs(amount * 100 - Math.round(amount * 100)) > 0.00001) return { kind: "noop" };
  return { kind: "paid", purchaseId, resourceId, paymentId,
    amountMinor: Math.round(amount * 100), currency };
}
