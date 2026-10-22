import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { isAdmin } from "@/lib/admin";
import { getThemePreset, themeOptions } from "@/lib/theme";
import { ThemeEditor } from "./theme-editor";
import { getThemeSelection, themeChoices, templateOptions } from "@/lib/theme-selection";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { getSiteConfig } from "@/lib/site-config";

export async function generateMetadata(): Promise<Metadata> {
  await connection();
  return {
    title: `Theme | ${getSiteConfig().name}`,
    description: "Administrator theme settings.",
    robots: { index: false, follow: false },
  };
}

export const instant = false;

export default async function ThemePage() {
  if (!(await isAdmin(await headers()))) notFound();
  const preset = getThemePreset();
  const selection = getThemeSelection();

  return (
    <main className="site-container">
      <div className="mb-8 max-w-2xl">
        <p className="text-sm font-medium text-muted-foreground">Site settings</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Theme</h1>
        <p className="mt-3 text-muted-foreground">Choose a preset and preview it before saving it for the directory.</p>
        <Link href="/admin/catalog" className="mt-3 inline-block text-sm underline">Manage listings</Link>
        <Link href="/admin/branding" className="ml-4 mt-3 inline-block text-sm underline">Branding</Link>
      </div>
      <ThemeEditor options={themeOptions} initialPreset={preset} initialSelection={selection}
        themes={themeChoices} templates={templateOptions} />
    </main>
  );
}
