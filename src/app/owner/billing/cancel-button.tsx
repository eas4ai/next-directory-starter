"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function CancelButton({ purchaseId, kind }: {
  purchaseId: string;
  kind: "checkout" | "subscription";
}) {
  const router = useRouter();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  async function scheduleCancellation() {
    setWorking(true);
    setError("");
    try {
      const response = await fetch(`/api/owner/billing/${encodeURIComponent(purchaseId)}/cancel`, {
        method: "POST",
      });
      if (!response.ok) {
        const result = await response.json() as { error?: string };
        throw new Error(result.error ?? (kind === "checkout"
          ? "Checkout could not be canceled" : "Cancellation could not be scheduled"));
      }
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : kind === "checkout"
        ? "Checkout could not be canceled" : "Cancellation could not be scheduled");
    } finally { setWorking(false); }
  }
  return <div>
    <Button type="button" variant="outline" disabled={working} onClick={scheduleCancellation}>
      {working ? (kind === "checkout" ? "Canceling…" : "Scheduling…") :
        kind === "checkout" ? "Cancel checkout" : "Cancel at period end"}
    </Button>
    {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
  </div>;
}
