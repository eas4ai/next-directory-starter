"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { BillingMode, BillingProfile, BillingProvider, PriceMapping } from "@/lib/billing-profiles";

const providers: BillingProvider[] = ["stripe", "paddle", "nowpayments"];
const modes: BillingMode[] = ["test", "live"];

function mappingLines(value: PriceMapping[]): string {
  return value.map(({ planKey, priceId }) => `${planKey}=${priceId}`).join("\n");
}

function parseMappings(value: string): PriceMapping[] {
  return value.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
    const equal = line.indexOf("=");
    if (equal < 1 || equal === line.length - 1) throw new Error("Use plan-key=provider-price-id for each mapping.");
    return { planKey: line.slice(0, equal).trim(), priceId: line.slice(equal + 1).trim() };
  });
}

function ProfileForm({ provider, mode, profile }: {
  provider: BillingProvider; mode: BillingMode; profile?: BillingProfile;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setPending(true);
    setMessage("");
    try {
      const data = new FormData(form);
      const apiKey = String(data.get("apiKey") ?? "").trim();
      const webhookSecret = String(data.get("webhookSecret") ?? "").trim();
      const input = {
        provider, mode, version: profile?.version ?? 0,
        enabled: data.has("enabled"),
        publicKey: String(data.get("publicKey") ?? ""),
        priceMappings: provider === "nowpayments" ? [] : parseMappings(String(data.get("priceMappings") ?? "")),
        ...(apiKey ? { apiKey } : {}),
        ...(webhookSecret ? { webhookSecret } : {}),
      };
      const response = await fetch("/api/admin/billing/profiles", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not save provider settings.");
      setMessage("Settings saved.");
      form.reset();
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save provider settings.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="grid gap-4 rounded-lg border p-5" onSubmit={(event) => { void save(event); }}>
      <div>
        <h2 className="text-lg font-semibold">{provider === "nowpayments" ? "NOWPayments" : provider === "paddle" ? "Paddle" : "Stripe"} · {mode}</h2>
        <p className="text-sm text-muted-foreground">{profile ? `Version ${profile.version} · ${profile.enabled ? "Enabled" : "Disabled"}` : "Not configured"}</p>
      </div>
      {provider !== "nowpayments" && <label className="grid gap-1 text-sm font-medium">Public key or client token
        <Input name="publicKey" defaultValue={profile?.publicKey ?? ""} maxLength={256} autoComplete="off" />
      </label>}
      <label className="grid gap-1 text-sm font-medium">API key {profile?.hasApiKey && <span className="text-muted-foreground">(saved)</span>}
        <Input name="apiKey" type="password" autoComplete="new-password" placeholder="Leave blank to keep saved key" />
      </label>
      <label className="grid gap-1 text-sm font-medium">Webhook signing secret {profile?.hasWebhookSecret && <span className="text-muted-foreground">(saved)</span>}
        <Input name="webhookSecret" type="password" autoComplete="new-password" placeholder="Leave blank to keep saved secret" />
      </label>
      {provider !== "nowpayments" && <label className="grid gap-1 text-sm font-medium">Plan price mappings, one per line
        <textarea name="priceMappings" defaultValue={mappingLines(profile?.priceMappings ?? [])}
          placeholder="plan-key=provider-price-id" rows={3}
          className="w-full rounded-md border bg-background px-3 py-2 font-mono text-sm text-foreground" />
      </label>}
      <label className="flex items-center gap-2 text-sm"><input name="enabled" type="checkbox" defaultChecked={profile?.enabled ?? false} /> Enable this mode</label>
      <Button type="submit" disabled={pending} className="justify-self-start">{pending ? "Saving…" : "Save settings"}</Button>
      {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
    </form>
  );
}

export function BillingEditor({ initialProfiles }: { initialProfiles: BillingProfile[] }) {
  return (
    <div className="mt-8 grid gap-6 lg:grid-cols-2">
      {providers.flatMap((provider) => modes.map((mode) => (
        <ProfileForm key={`${provider}:${mode}`} provider={provider} mode={mode}
          profile={initialProfiles.find((profile) => profile.provider === provider && profile.mode === mode)} />
      )))}
    </div>
  );
}
