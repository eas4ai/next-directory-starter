"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function SuspendButton({ slug }: { slug: string }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function suspend() {
    if (!reason.trim()) {
      setMessage("Give a reason before suspending.");
      return;
    }
    setPending(true);
    setMessage("");
    try {
      const response = await fetch(`/api/admin/listings/${encodeURIComponent(slug)}/suspend`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (!response.ok) {
        setMessage((await response.json()).error ?? "Could not suspend this listing.");
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
    <div className="mt-4 flex flex-wrap items-end gap-2 border-t pt-4">
      <label className="grid min-w-48 flex-1 gap-2 text-sm font-medium">Suspension reason
        <Input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} />
      </label>
      <Button type="button" variant="destructive" aria-label={`Suspend ${slug}`} disabled={pending} onClick={suspend}>Suspend listing</Button>
      {message && <p role="alert" className="w-full text-sm text-destructive">{message}</p>}
    </div>
  );
}
