"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useRouter } from "next/navigation";
import { PresetExternalLinkIcon } from "@/components/preset-icon";
import type { ThemePreset } from "@/lib/theme";

const labels: Record<keyof ThemePreset, string> = {
  style: "Style",
  baseColor: "Base color",
  theme: "Theme color",
  chartColor: "Chart color",
  iconLibrary: "Icon library",
  font: "Body font",
  fontHeading: "Heading font",
  radius: "Radius",
  menuAccent: "Menu accent",
  menuColor: "Menu color",
  mode: "Mode",
};

function displayName(value: string): string {
  return value.split("-").map((part) => part[0].toUpperCase() + part.slice(1)).join(" ");
}

type Props = {
  options: Record<keyof ThemePreset, string[]>;
  initialPreset: ThemePreset;
  initialCss: string;
};

export function ThemeEditor({ options, initialPreset, initialCss }: Props) {
  const router = useRouter();
  const [preset, setPreset] = useState(initialPreset);
  const [css, setCss] = useState(initialCss);
  const [status, setStatus] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    async function preview() {
      try {
        const response = await fetch("/api/admin/theme/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(preset),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Preview failed.");
        const result = await response.json() as { css: string };
        setCss(result.css);
      } catch (error) {
        if (!controller.signal.aborted) setStatus(error instanceof Error ? error.message : "Preview failed.");
      }
    }
    void preview();
    return () => controller.abort();
  }, [preset]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("Saving…");
    try {
      const response = await fetch("/api/admin/theme", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(preset),
      });
      if (!response.ok) throw new Error("The theme could not be saved.");
      setStatus("Theme saved.");
      router.refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The theme could not be saved.");
    }
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card>
        <CardHeader><CardTitle>Preset choices</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={save} className="grid gap-5 sm:grid-cols-2">
            {(Object.keys(options) as (keyof ThemePreset)[]).map((field) => (
              <div key={field} className="grid gap-2">
                <label htmlFor={`theme-${field}`} className="text-sm font-medium">{labels[field]}</label>
                <select
                  id={`theme-${field}`}
                  name={field}
                  value={preset[field]}
                  onChange={(event) => {
                    setPreset((current) => ({ ...current, [field]: event.target.value }));
                    setStatus("Unsaved changes");
                  }}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {options[field].map((choice) => <option key={choice} value={choice}>{displayName(choice)}</option>)}
                </select>
              </div>
            ))}
            <div className="flex items-center gap-3 sm:col-span-2">
              <Button type="submit">Save theme</Button>
              <p role="status" aria-live="polite" className="text-sm text-muted-foreground">{status}</p>
            </div>
          </form>
        </CardContent>
      </Card>

      <div>
        <style>{css}</style>
        <section className="theme-preview overflow-hidden rounded-xl border" data-mode={preset.mode} aria-label="Theme preview">
          <div className="space-y-6 p-6" style={{ background: "var(--background)", color: "var(--foreground)", fontFamily: "var(--preset-body-font)" }}>
            <div>
              <p className="text-xs uppercase tracking-widest" style={{ color: "var(--muted-foreground)" }}>Live preview · {displayName(preset.style)}</p>
              <h2 className="mt-2 text-2xl font-semibold" style={{ fontFamily: "var(--preset-heading-font)" }}>Find something useful</h2>
              <p className="mt-2 text-sm" style={{ color: "var(--muted-foreground)" }}>A sample directory card in your selected palette and type.</p>
            </div>
            <div className="rounded-lg border p-5" style={{ background: "var(--card)", borderColor: "var(--border)", borderRadius: "var(--radius)", boxShadow: "var(--preset-shadow)" }}>
              <p className="text-sm font-semibold">Example Tool</p>
              <p className="mt-1 text-sm" style={{ color: "var(--muted-foreground)" }}>A sample link for your directory</p>
              <div className="mt-4 flex items-center gap-3">
                <span className="inline-flex items-center gap-2 px-4 text-sm font-medium" style={{ height: "var(--preset-control-height)", background: "var(--primary)", color: "var(--primary-foreground)", borderRadius: "var(--radius)" }}>Visit listing <PresetExternalLinkIcon library={preset.iconLibrary} /></span>
                <span className="text-xs" style={{ color: "var(--muted-foreground)" }}>{displayName(preset.iconLibrary)} icons</span>
              </div>
            </div>
            <div className="flex gap-1" aria-label="Chart colors">
              {[1, 2, 3, 4, 5].map((index) => <span key={index} className="h-6 flex-1 rounded-sm" style={{ background: `var(--chart-${index})` }} />)}
            </div>
            <div className="rounded-lg border px-4 py-3 text-sm" style={{ background: "var(--sidebar)", color: "var(--sidebar-foreground)", borderColor: "var(--sidebar-border)", opacity: "var(--preset-menu-opacity)" }}>
              <span className="rounded px-2 py-1" style={{ background: "var(--sidebar-accent)", color: "var(--sidebar-accent-foreground)" }}>Menu preview</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
