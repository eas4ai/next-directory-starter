"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PublishingPlan } from "@/lib/plans";

function fields(form: HTMLFormElement) {
  const data = new FormData(form);
  const billingMode = String(data.get("billingMode") ?? "one-time");
  return {
    name: String(data.get("name") ?? ""),
    description: String(data.get("description") ?? ""),
    mode: String(data.get("mode") ?? "test"),
    billingMode,
    amountMinor: billingMode === "free" ? 0 : Number(data.get("amountMinor")),
    currency: String(data.get("currency") ?? "usd").toLowerCase(),
    durationDays: billingMode === "one-time" ? Number(data.get("durationDays")) : null,
    featured: billingMode !== "free" && data.has("featured"),
    enabled: data.has("enabled"),
  };
}

function PlanForm({ plan, pending, onSave }: {
  plan?: PublishingPlan;
  pending: boolean;
  onSave: (input: Record<string, unknown>) => Promise<boolean>;
}) {
  const [billingMode, setBillingMode] = useState(plan?.billingMode ?? "one-time");
  return (
    <form className="grid gap-4 rounded-lg border p-5" onSubmit={(event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const form = event.currentTarget;
      void onSave({ ...(plan ? {} : { key: String(new FormData(form).get("key") ?? "") }), ...fields(form) })
        .then((saved) => { if (saved && !plan) form.reset(); });
    }}>
      <div className="grid gap-4 md:grid-cols-2">
        {plan ? <h3 className="font-medium md:col-span-2 break-all">{plan.key}</h3> :
          <label className="grid gap-1 text-sm font-medium">Key
            <Input name="key" required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={64} placeholder="featured-thirty" />
          </label>}
        <label className="grid gap-1 text-sm font-medium">Name
          <Input name="name" defaultValue={plan?.name} required maxLength={120} />
        </label>
        <label className="grid gap-1 text-sm font-medium md:col-span-2">Description
          <Input name="description" defaultValue={plan?.description ?? ""} maxLength={500} />
        </label>
        <label className="grid gap-1 text-sm font-medium">Checkout mode
          <select name="mode" defaultValue={plan?.mode ?? "test"}
            className="h-9 rounded-md border bg-background px-3 text-foreground">
            <option value="test">Test</option><option value="live">Live</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm font-medium">Billing mode
          <select name="billingMode" value={billingMode} onChange={(event) => setBillingMode(event.target.value as PublishingPlan["billingMode"])}
            className="h-9 rounded-md border bg-background px-3 text-foreground">
            <option value="free">Free</option><option value="one-time">One-time</option>
            <option value="monthly">Monthly</option><option value="annual">Annual</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm font-medium">Price in minor units
          <Input name="amountMinor" type="number" min={billingMode === "free" ? 0 : 1} max={1000000000} step={1}
            defaultValue={plan?.amountMinor ?? 0} disabled={billingMode === "free"} required={billingMode !== "free"} />
        </label>
        <label className="grid gap-1 text-sm font-medium">Currency
          <select name="currency" defaultValue={plan?.currency ?? "usd"}
            className="h-9 rounded-md border bg-background px-3 text-foreground">
            {["usd", "eur", "gbp", "cad", "aud"].map((currency) =>
              <option key={currency} value={currency}>{currency.toUpperCase()}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-sm font-medium">Duration in days
          <Input name="durationDays" type="number" min={1} max={3650} step={1}
            defaultValue={plan?.durationDays ?? 30} disabled={billingMode !== "one-time"}
            required={billingMode === "one-time"} />
        </label>
      </div>
      <div className="flex flex-wrap gap-5 text-sm">
        <label className="flex items-center gap-2"><input name="featured" type="checkbox" defaultChecked={plan?.featured}
          disabled={billingMode === "free"} /> Featured placement</label>
        <label className="flex items-center gap-2"><input name="enabled" type="checkbox" defaultChecked={plan?.enabled ?? true} /> Available to owners</label>
      </div>
      <Button type="submit" disabled={pending} className="justify-self-start">{plan ? "Save plan" : "Create plan"}</Button>
    </form>
  );
}

export function PlanEditor({ initialPlans }: { initialPlans: PublishingPlan[] }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function save(input: Record<string, unknown>, key?: string): Promise<boolean> {
    setPending(true);
    setMessage("");
    try {
      const response = await fetch(key ? `/api/admin/plans/${encodeURIComponent(key)}` : "/api/admin/plans", {
        method: key ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not save plan.");
      setMessage(`Saved ${result.plan.name}.`);
      router.refresh();
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save plan.");
      return false;
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mt-8 space-y-8">
      <section>
        <h2 className="mb-4 text-xl font-semibold">Create a plan</h2>
        <PlanForm pending={pending} onSave={(input) => save(input)} />
      </section>
      <section>
        <h2 className="mb-4 text-xl font-semibold">Existing plans</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          {initialPlans.map((plan) => <PlanForm key={plan.key} plan={plan} pending={pending}
            onSave={(input) => save(input, plan.key)} />)}
        </div>
        {initialPlans.length === 0 && <p className="text-sm text-muted-foreground">No plans yet.</p>}
      </section>
      {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
    </div>
  );
}
