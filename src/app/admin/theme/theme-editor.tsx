"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useRouter } from "next/navigation";
import type { ThemePreset } from "@/lib/theme";
import type { ThemeSelection } from "@/lib/theme-selection";
import { ThemePreview } from "./theme-preview";

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
  initialSelection: ThemeSelection;
  themes: readonly { id: string; name: string }[];
  templates: readonly { id: string; name: string }[];
};

export function ThemeEditor({ options, initialPreset, initialSelection, themes, templates }: Props) {
  const router = useRouter();
  const [preset, setPreset] = useState(initialPreset);
  const [status, setStatus] = useState("");
  const [selection, setSelection] = useState(initialSelection);
  const [selectionStatus, setSelectionStatus] = useState("");
  const previewHref = `/api/admin/theme/preview.css?${new URLSearchParams({
    preset: JSON.stringify(preset), themeId: "preset", scope: "preset",
  })}`;
  const selectionHref = `/api/admin/theme/preview.css?${new URLSearchParams({
    preset: JSON.stringify(preset), themeId: selection.themeId, scope: "selection",
  })}`;

  async function save(event: FormEvent<HTMLFormElement>, kind: "preset" | "selection") {
    event.preventDefault();
    const update = kind === "preset" ? setStatus : setSelectionStatus;
    const errorMessage = kind === "preset" ? "The theme could not be saved." :
      "The theme or template could not be saved.";
    update("Saving…");
    try {
      const response = await fetch(kind === "preset" ? "/api/admin/theme" : "/api/admin/theme/selection", {
        method: kind === "preset" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(kind === "preset" ? preset : selection),
      });
      if (!response.ok) throw new Error(errorMessage);
      update(kind === "preset" ? "Theme saved." : "Theme and template saved.");
      router.refresh();
    } catch (error) {
      update(error instanceof Error ? error.message : errorMessage);
    }
  }

  return (
    <>
    <div className="grid gap-8 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle>Preset choices</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={(event) => save(event, "preset")} className="grid gap-5 sm:grid-cols-2">
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
        <link rel="stylesheet" href={previewHref} />
        <ThemePreview scope="preset" library={preset.iconLibrary} mode={preset.mode}
          styleName={displayName(preset.style)} />
      </div>
    </div>
    <div className="mt-10 grid gap-8 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle>Installed designs</CardTitle></CardHeader>
        <CardContent>
          <p className="mb-5 text-sm text-muted-foreground">Preview an installed theme and public layout before applying them to the site.</p>
          <form className="grid gap-5" onSubmit={(event) => save(event, "selection")}>
            <label className="grid gap-2 text-sm font-medium">Theme
              <select name="themeId" value={selection.themeId}
                onChange={(event) => { setSelection((current) => ({ ...current, themeId: event.target.value })); setSelectionStatus("Unsaved changes"); }}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                {themes.map((theme) => <option key={theme.id} value={theme.id}>{theme.name}</option>)}
              </select>
            </label>
            <label className="grid gap-2 text-sm font-medium">Public template
              <select name="templateId" value={selection.templateId}
                onChange={(event) => { setSelection((current) => ({ ...current, templateId: event.target.value })); setSelectionStatus("Unsaved changes"); }}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
              </select>
            </label>
            <div className="flex items-center gap-3">
              <Button type="submit">Apply design</Button>
              <p role="status" aria-live="polite" className="text-sm text-muted-foreground">{selectionStatus}</p>
            </div>
          </form>
        </CardContent>
      </Card>
      <div>
        <link rel="stylesheet" href={selectionHref} />
        <ThemePreview scope="selection" library={preset.iconLibrary} mode={preset.mode}
          styleName={`${themes.find((theme) => theme.id === selection.themeId)?.name ?? "Theme"} · ${
            templates.find((template) => template.id === selection.templateId)?.name ?? "Template"}`}
          templateId={selection.templateId} />
      </div>
    </div>
    </>
  );
}
