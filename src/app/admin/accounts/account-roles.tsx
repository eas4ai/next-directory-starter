"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ManagedAccount } from "@/lib/accounts";

const roles = ["user", "editor", "moderator", "admin"] as const;
type AccountUpdate = (id: string, action: "role" | "suspension", input: {
  role?: string; suspended?: boolean; reason?: string;
}) => Promise<void>;

function AccountControls({ account, pending, update }: {
  account: ManagedAccount; pending: boolean; update: AccountUpdate;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 rounded-lg border p-4">
      <div className="min-w-0">
        <h2 className="font-medium break-words">{account.name}</h2>
        <p className="text-sm text-muted-foreground break-all">{account.email}</p>
        <p className="text-xs text-muted-foreground">{account.banned ? "Suspended" : "Active"}</p>
      </div>
      <div className="grid gap-3">
        <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => {
          event.preventDefault();
          void update(account.id, "role", { role: String(new FormData(event.currentTarget).get("role") ?? "") });
        }}>
          <label className="grid gap-1 text-sm font-medium">Role
            <select name="role" defaultValue={account.role ?? "user"}
              className="h-9 rounded-md border bg-background px-3 text-foreground">
              {roles.map((role) => <option key={role} value={role}>{role}</option>)}
            </select>
          </label>
          <Button type="submit" size="sm" disabled={pending}>Save role</Button>
        </form>
        <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => {
          event.preventDefault();
          void update(account.id, "suspension", {
            suspended: !account.banned,
            reason: String(new FormData(event.currentTarget).get("reason") ?? ""),
          });
        }}>
          {!account.banned && <label className="grid gap-1 text-sm font-medium">Reason
            <Input name="reason" maxLength={280} required placeholder="Why suspend this account?" />
          </label>}
          <Button type="submit" size="sm" variant={account.banned ? "outline" : "destructive"}
            disabled={pending}>{account.banned ? "Reinstate" : "Suspend"}</Button>
        </form>
      </div>
    </div>
  );
}

export function AccountRoles({ accounts }: { accounts: ManagedAccount[] }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const update: AccountUpdate = async (id, action, input) => {
    setPendingId(id);
    setMessage("");
    try {
      const response = await fetch(`/api/admin/accounts/${encodeURIComponent(id)}/${action}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not update account status.");
      const verb = action === "role" ? "Updated" : input.suspended ? "Suspended" : "Reinstated";
      setMessage(`${verb} ${result.account.email}.`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update account status.");
    } finally {
      setPendingId(null);
    }
  };

  return (
    <section className="mt-8 space-y-3" aria-label="Managed accounts">
      {accounts.map((account) => <AccountControls key={account.id} account={account}
        pending={pendingId !== null} update={update} />)}
      {accounts.length === 0 && <p className="text-sm text-muted-foreground">No accounts yet.</p>}
      {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
    </section>
  );
}
