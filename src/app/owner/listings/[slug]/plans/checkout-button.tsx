"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";

export function CheckoutButton({ slug, planKey, offerToken, billingMode }: {
  slug: string; planKey: string; offerToken: string; billingMode: "free" | "one-time";
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const requestId = useRef<string | null>(null);

  async function checkout() {
    setPending(true);
    setError("");
    try {
      if (billingMode === "one-time") requestId.current ??= crypto.randomUUID();
      const response = await fetch(`/api/owner/listings/${encodeURIComponent(slug)}/${billingMode === "free" ? "plans/free" : "checkout"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(billingMode === "free" ? { planKey, offerToken } :
          { planKey, offerToken, requestId: requestId.current }),
      });
      const result = await response.json();
      if (billingMode === "free") {
        if (!response.ok || typeof result.purchaseId !== "string") {
          throw new Error(result.error ?? "Could not select the free plan.");
        }
        setSuccess("Free plan selected. Your approved listing remains public.");
        setPending(false);
        return;
      }
      if (!response.ok || typeof result.url !== "string") {
        throw new Error(result.error ?? "Could not start checkout.");
      }
      window.location.assign(result.url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start checkout.");
      setPending(false);
    }
  }

  return (
    <div className="mt-auto pt-3">
      <Button type="button" disabled={pending} onClick={() => { void checkout(); }}>
        {pending ? "Please wait…" : billingMode === "free" ? "Select free plan" : "Continue to Stripe Checkout"}
      </Button>
      {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
      {success && <p role="status" className="mt-2 text-sm text-muted-foreground">{success}</p>}
    </div>
  );
}
