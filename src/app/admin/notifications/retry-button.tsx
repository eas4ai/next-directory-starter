"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function RetryButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function retry() {
    setPending(true);
    setMessage("");
    try {
      const response = await fetch(`/api/admin/notifications/${encodeURIComponent(id)}/retry`,
        { method: "POST" });
      if (!response.ok) {
        setMessage((await response.json()).error ?? "Could not retry delivery.");
        return;
      }
      setMessage("Ready for the next delivery run.");
      router.refresh();
    } catch {
      setMessage("Could not connect to the server. Try again.");
    } finally {
      setPending(false);
    }
  }

  return <div className="space-y-1">
    <Button type="button" size="sm" variant="outline" disabled={pending} onClick={retry}>Retry delivery</Button>
    {message && <p role="status" className="text-xs text-muted-foreground">{message}</p>}
  </div>;
}
