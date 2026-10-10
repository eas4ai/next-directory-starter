"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";

type BillingMode = "free" | "one-time" | "monthly" | "annual";
type Provider = "stripe" | "paddle" | "nowpayments";

function providerName(provider: Provider | undefined): string {
  if (provider === "nowpayments") return "NOWPayments";
  if (provider === "paddle") return "Paddle";
  return "Stripe";
}

type CheckoutRequest = { slug: string; planKey: string; offerToken: string;
  billingMode: BillingMode; provider?: Provider; requestId: string | null };

async function submitCheckout({ slug, planKey, offerToken, billingMode, provider, requestId }:
  CheckoutRequest): Promise<{ url?: string }> {
  const free = billingMode === "free";
  const response = await fetch(`/api/owner/listings/${encodeURIComponent(slug)}/${free ? "plans/free" : "hosted-checkout"}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(free ? { planKey, offerToken } :
      { planKey, offerToken, provider, requestId }),
  });
  const result = await response.json();
  if (!response.ok || (free ? typeof result.purchaseId !== "string" : typeof result.url !== "string")) {
    throw new Error(result.error ?? "Could not start checkout.");
  }
  return result;
}

export function CheckoutButton({ slug, planKey, offerToken, billingMode, provider }: {
  slug: string; planKey: string; offerToken: string;
  billingMode: BillingMode;
  provider?: Provider;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const requestId = useRef<string | null>(null);

  async function checkout() {
    setPending(true);
    setError("");
    try {
      if (billingMode !== "free") requestId.current ??= crypto.randomUUID();
      const result = await submitCheckout({ slug, planKey, offerToken,
        billingMode, provider, requestId: requestId.current });
      if (billingMode === "free") {
        setSuccess("Free plan selected. Your approved listing remains public.");
        setPending(false);
        return;
      }
      window.location.assign(result.url!);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start checkout.");
      setPending(false);
    }
  }

  return (
    <div className="mt-auto pt-3">
      <Button type="button" disabled={pending} onClick={() => { void checkout(); }}>
        {pending ? "Please wait…" : billingMode === "free" ? "Select free plan" :
          `Continue to ${providerName(provider)}`}
      </Button>
      {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
      {success && <p role="status" className="mt-2 text-sm text-muted-foreground">{success}</p>}
    </div>
  );
}
