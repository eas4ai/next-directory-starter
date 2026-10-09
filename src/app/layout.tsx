import type { Metadata } from "next";
import "./globals.css";
import { getThemePreset, presetCss, themeOptions } from "@/lib/theme";
import Link from "next/link";
import { PresetExternalLinkIcon } from "@/components/preset-icon";
import { connection } from "next/server";
import { getSiteConfig } from "@/lib/site-config";

export async function generateMetadata(): Promise<Metadata> {
  await connection();
  const site = getSiteConfig();
  return {
    title: site.name,
    description: site.description,
    icons: site.iconUrl ? { icon: site.iconUrl } : undefined,
  };
}

export const instant = false;

export default async function RootLayout({ children }: LayoutProps<"/">) {
  await connection();
  const preset = getThemePreset();
  const site = getSiteConfig();
  const presetCode = (Object.keys(themeOptions) as (keyof typeof themeOptions)[])
    .map((field) => preset[field]).join(".");

  return (
    <html lang="en" className={preset.mode === "dark" ? "dark" : ""} data-mode={preset.mode} data-site-preset={presetCode}>
      <head><style id="site-preset">{presetCss(preset, ":root")}</style></head>
      <body>
        <header className="border-b" style={{ background: "var(--sidebar)", color: "var(--sidebar-foreground)", borderColor: "var(--sidebar-border)" }}>
          <nav className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4" aria-label="Main navigation">
            <Link href="/" className="inline-flex items-center gap-2 font-semibold tracking-tight">
              {/* Operator assets can use any host, so a fixed image optimizer allowlist would block valid sites. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {site.logoUrl && <img src={site.logoUrl} alt="" className="size-7 object-contain" />}
              {site.name}
            </Link>
            <div className="flex items-center gap-2">
              <Link href="/owner/listings" className="rounded-md px-3 py-2 text-sm">Submit a link</Link>
              <Link href="/listings" className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm" style={{ background: "var(--sidebar-accent)", color: "var(--sidebar-accent-foreground)" }}>Listings <PresetExternalLinkIcon library={preset.iconLibrary} /></Link>
            </div>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
