"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function ReviewDecision({ id }: { id: string }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function decide(decision: "approve" | "reject") {
    if (!reason.trim()) {
      setMessage("Give a reason for this decision.");
      return;
    }
    setPending(true);
    setMessage("");
    try {
      const response = await fetch(`/api/admin/submissions/${id}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, reason }),
      });
      if (!response.ok) {
        setMessage((await response.json()).error ?? "Could not save the decision.");
        return;
      }
      router.refresh();
    } catch {
      setMessage("Could not connect to the server. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mt-4 space-y-3 border-t pt-4">
      <label className="grid gap-2 text-sm font-medium">Reason
        <Input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} placeholder="Required for every decision" />
      </label>
      <div className="flex gap-2">
        <Button type="button" disabled={pending} onClick={() => decide("approve")}>Approve</Button>
        <Button type="button" variant="destructive" disabled={pending} onClick={() => decide("reject")}>Reject</Button>
      </div>
      {message && <p role="alert" className="text-sm text-destructive">{message}</p>}
    </div>
  );
}
