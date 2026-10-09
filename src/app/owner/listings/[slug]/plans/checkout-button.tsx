"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

export function CheckoutButton({ slug, planKey }: { slug: string; planKey: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function checkout() {
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/owner/listings/${encodeURIComponent(slug)}/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planKey }),
      });
      const result = await response.json();
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
        {pending ? "Opening Checkout…" : "Continue to Stripe Checkout"}
      </Button>
      {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  );
}
