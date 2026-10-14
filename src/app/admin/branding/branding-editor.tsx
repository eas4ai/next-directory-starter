"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SiteConfig } from "@/lib/site-config";

type Slot = "logo" | "icon" | "social";
const imageFields = [
  { slot: "logo", field: "logoUrl", label: "Logo", help: "Shown beside the site name." },
  { slot: "icon", field: "iconUrl", label: "Favicon", help: "Shown in browser tabs." },
  { slot: "social", field: "socialImage", label: "Default social image", help: "Used when published content and search settings have no image." },
] as const;

export function BrandingEditor({ initial }: { initial: SiteConfig }) {
  const router = useRouter();
  const [brand, setBrand] = useState(initial);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setStatus("Saving…");
    try {
      const response = await fetch("/api/admin/branding", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(brand),
      });
      if (!response.ok) {
        const result = await response.json() as { error?: string };
        throw new Error(result.error ?? "Branding could not be saved.");
      }
      const result = await response.json() as { branding: SiteConfig };
      setBrand(result.branding);
      setStatus("Branding saved.");
      router.refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Branding could not be saved.");
    } finally { setBusy(false); }
  }

  async function upload(slot: Slot, file: File) {
    if (file.size > 5 * 1024 * 1024) {
      setStatus("The image must be 5 MB or smaller.");
      return;
    }
    setBusy(true);
    setStatus(`Uploading ${slot}…`);
    try {
      const response = await fetch("/api/admin/branding/assets", {
        method: "POST", headers: { "Content-Type": file.type, "X-Brand-Slot": slot },
        body: file,
      });
      if (!response.ok) {
        const result = await response.json() as { error?: string };
        throw new Error(result.error ?? "The image could not be uploaded.");
      }
      const result = await response.json() as { branding: SiteConfig };
      setBrand((current) => ({ ...current,
        logoUrl: slot === "logo" ? result.branding.logoUrl : current.logoUrl,
        iconUrl: slot === "icon" ? result.branding.iconUrl : current.iconUrl,
        socialImage: slot === "social" ? result.branding.socialImage : current.socialImage,
      }));
      setStatus(`${slot} uploaded. Save any other edits to apply them.`);
      router.refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The image could not be uploaded.");
    } finally { setBusy(false); }
  }

  return (
    <form onSubmit={save} className="mt-8 grid max-w-3xl gap-7">
      <label className="grid gap-2 text-sm font-medium">Site name
        <Input name="name" value={brand.name} maxLength={120} required
          onChange={(event) => setBrand({ ...brand, name: event.target.value })} />
      </label>
      <label className="grid gap-2 text-sm font-medium">Site description
        <textarea name="description" value={brand.description} maxLength={280} required rows={3}
          onChange={(event) => setBrand({ ...brand, description: event.target.value })}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
      </label>
      {imageFields.map(({ slot, field, label, help }) => (
        <div key={slot} className="grid gap-3 rounded-lg border p-4">
          <label htmlFor={`brand-${slot}`} className="text-sm font-medium">{label}</label>
          <p className="text-sm text-muted-foreground">{help} Use a public path or HTTP(S) image URL, or upload a JPEG, PNG, or WebP file.</p>
          <Input id={`brand-${slot}`} name={field} value={brand[field] ?? ""} maxLength={2048}
            onChange={(event) => setBrand({ ...brand, [field]: event.target.value })} />
          <label className="grid gap-2 text-sm">Upload {label.toLowerCase()}
            <Input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void upload(slot, file);
                event.target.value = "";
              }} />
          </label>
          {brand[field] && <p className="break-all text-xs text-muted-foreground">Current: {brand[field]}</p>}
        </div>
      ))}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={busy}>Save branding</Button>
        <p role="status" aria-live="polite" className="text-sm text-muted-foreground">{status}</p>
      </div>
    </form>
  );
}
