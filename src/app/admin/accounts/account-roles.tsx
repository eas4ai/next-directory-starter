"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { ManagedAccount } from "@/lib/accounts";

const roles = ["user", "editor", "moderator", "admin"] as const;

export function AccountRoles({ accounts }: { accounts: ManagedAccount[] }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  async function changeRole(id: string, role: string) {
    setPendingId(id);
    setMessage("");
    try {
      const response = await fetch(`/api/admin/accounts/${encodeURIComponent(id)}/role`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not update role.");
      setMessage(`Updated ${result.account.email}.`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update role.");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <section className="mt-8 space-y-3" aria-label="Managed accounts">
      {accounts.map((account) => (
        <div key={account.id} className="flex flex-wrap items-end justify-between gap-4 rounded-lg border p-4">
          <div className="min-w-0">
            <h2 className="font-medium break-words">{account.name}</h2>
            <p className="text-sm text-muted-foreground break-all">{account.email}</p>
          </div>
          <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => {
            event.preventDefault();
            void changeRole(account.id, String(new FormData(event.currentTarget).get("role") ?? ""));
          }}>
            <label className="grid gap-1 text-sm font-medium">Role
              <select name="role" defaultValue={account.role ?? "user"}
                className="h-9 rounded-md border bg-background px-3 text-foreground">
                {roles.map((role) => <option key={role} value={role}>{role}</option>)}
              </select>
            </label>
            <Button type="submit" size="sm" disabled={pendingId !== null}>Save role</Button>
          </form>
        </div>
      ))}
      {accounts.length === 0 && <p className="text-sm text-muted-foreground">No accounts yet.</p>}
      {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
    </section>
  );
}
