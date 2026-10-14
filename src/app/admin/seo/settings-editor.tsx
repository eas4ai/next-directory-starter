"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SeoSettings } from "@/lib/seo-settings";

export function SeoSettingsEditor({ initial }: { initial: SeoSettings }) {
  const [settings, setSettings] = useState(initial);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    try {
      const input = Object.fromEntries(new FormData(event.currentTarget));
      const response = await fetch("/api/admin/seo/settings", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
      });
      const result = await response.json();
      if (!response.ok) { setMessage(result.error ?? "Could not save search settings."); return; }
      setSettings(result.settings as SeoSettings);
      setMessage("Search settings saved.");
    } catch { setMessage("Could not connect to the server."); }
    finally { setPending(false); }
  }

  return (
    <form onSubmit={save} className="mt-8 grid max-w-2xl gap-5 rounded-lg border p-6">
      <label className="grid gap-2 text-sm font-medium">Title format
        <Input name="titleFormat" defaultValue={settings.titleFormat} required maxLength={200} />
        <span className="text-xs font-normal text-muted-foreground">Use %s once for the page title.</span>
      </label>
      <label className="grid gap-2 text-sm font-medium">Default description
        <textarea name="description" defaultValue={settings.description} required maxLength={320}
          className="min-h-24 rounded-md border border-input bg-background px-3 py-2 text-sm" />
      </label>
      <label className="grid gap-2 text-sm font-medium">Default social image
        <Input name="socialImage" defaultValue={settings.socialImage ?? ""} maxLength={2048} placeholder="/social.png" />
      </label>
      <label className="grid gap-2 text-sm font-medium">Google verification
        <Input name="googleVerification" defaultValue={settings.googleVerification ?? ""} maxLength={160} />
      </label>
      <label className="grid gap-2 text-sm font-medium">Bing verification
        <Input name="bingVerification" defaultValue={settings.bingVerification ?? ""} maxLength={160} />
      </label>
      <Button type="submit" disabled={pending}>Save search settings</Button>
      {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
    </form>
  );
}
