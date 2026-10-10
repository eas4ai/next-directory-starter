import Stripe from "stripe";
import { Environment, Paddle } from "@paddle/paddle-node-sdk";
import type { CheckoutConfiguration } from "@/lib/billing-profiles";
import { publicUrl } from "@/lib/page-metadata";
import type { PublishingPlan } from "@/lib/plans";

export type HostedPurchase = {
  id: string;
  listingSlug: string;
  ownerUserId: string;
  plan: Pick<PublishingPlan,
    "key" | "name" | "billingMode" | "amountMinor" | "currency" | "durationDays">;
  providerPriceId: string | null;
};

export type HostedSession = { resourceId: string; url: string };
export type CreateHostedSession = (purchase: HostedPurchase,
  configuration: CheckoutConfiguration) => Promise<HostedSession>;

function returnUrl(purchase: HostedPurchase, outcome: "return" | "cancel"): string {
  return publicUrl(`/owner/listings/${encodeURIComponent(purchase.listingSlug)}/plans?checkout=${outcome}`);
}

async function stripeSession(purchase: HostedPurchase,
  configuration: CheckoutConfiguration): Promise<HostedSession> {
    const stripe = new Stripe(configuration.apiKey);
    const recurring = purchase.plan.billingMode === "monthly" || purchase.plan.billingMode === "annual";
    const lineItem: Stripe.Checkout.SessionCreateParams.LineItem = purchase.providerPriceId
      ? { price: purchase.providerPriceId, quantity: 1 }
      : { quantity: 1, price_data: {
        currency: purchase.plan.currency, unit_amount: purchase.plan.amountMinor,
        product_data: { name: purchase.plan.name },
      } };
    const session = await stripe.checkout.sessions.create({
      mode: recurring ? "subscription" : "payment",
      client_reference_id: purchase.id,
      success_url: returnUrl(purchase, "return"),
      cancel_url: returnUrl(purchase, "cancel"),
      line_items: [lineItem],
      metadata: { purchaseId: purchase.id, listingSlug: purchase.listingSlug,
        ownerUserId: purchase.ownerUserId, planKey: purchase.plan.key,
        providerPriceId: purchase.providerPriceId ?? "" },
      subscription_data: recurring ? { metadata: { purchaseId: purchase.id } } : undefined,
      payment_intent_data: recurring ? undefined : { metadata: { purchaseId: purchase.id } },
    }, { idempotencyKey: purchase.id });
    if (!session.id || !session.url) throw new Error("Stripe did not return a hosted checkout URL");
    return { resourceId: session.id, url: session.url };
}

async function paddleSession(purchase: HostedPurchase,
  configuration: CheckoutConfiguration): Promise<HostedSession> {
    if (!purchase.providerPriceId) throw new Error("Paddle price mapping is missing");
    const paddle = new Paddle(configuration.apiKey, {
      environment: configuration.mode === "test" ? Environment.sandbox : Environment.production,
    });
    const transaction = await paddle.transactions.create({
      items: [{ priceId: purchase.providerPriceId, quantity: 1 }],
      customData: { purchaseId: purchase.id, listingSlug: purchase.listingSlug,
        ownerUserId: purchase.ownerUserId, planKey: purchase.plan.key },
    });
    if (!transaction.id || !transaction.checkout?.url) {
      throw new Error("Paddle did not return a hosted checkout URL");
    }
    return { resourceId: transaction.id, url: transaction.checkout.url };
}

async function nowPaymentsSession(purchase: HostedPurchase,
  configuration: CheckoutConfiguration): Promise<HostedSession> {
  if (purchase.plan.billingMode !== "one-time") throw new Error("NOWPayments invoices are one-time only");
  const { NowPaymentsSDK } = await import("@nowpaymentsio/nowpayments-sdk-nodejs");
  const callback = publicUrl(`/api/webhooks/nowpayments/${configuration.mode}`);
  if (new URL(callback).protocol !== "https:") {
    throw new Error("NOWPayments needs an HTTPS public site URL for payment notifications");
  }
  const sdk = new NowPaymentsSDK({
    apiKey: configuration.apiKey, ipnSecret: configuration.webhookSecret,
    baseUrl: configuration.mode === "test" ? "https://api-sandbox.nowpayments.io" : "https://api.nowpayments.io",
    ipnCallbackUrl: callback,
    successUrl: returnUrl(purchase, "return"),
    cancelUrl: returnUrl(purchase, "cancel"),
    timeoutMs: 15_000,
  });
  const invoice = await sdk.createCheckout({
    amount: purchase.plan.amountMinor / 100,
    currency: purchase.plan.currency,
    orderId: purchase.id,
    description: `${purchase.plan.name} · ${purchase.listingSlug}`,
  });
  if (!invoice.id || !invoice.invoice_url) throw new Error("NOWPayments did not return a hosted invoice URL");
  return { resourceId: invoice.id, url: invoice.invoice_url };
}

export const createHostedSession: CreateHostedSession = async (purchase, configuration) => {
  if (configuration.provider === "stripe") return stripeSession(purchase, configuration);
  if (configuration.provider === "paddle") return paddleSession(purchase, configuration);
  return nowPaymentsSession(purchase, configuration);
};
