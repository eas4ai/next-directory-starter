import type { Metadata } from "next";
import "./globals.css";
import { getThemePreset, presetCss, themeOptions } from "@/lib/theme";
import Link from "next/link";
import { PresetExternalLinkIcon } from "@/components/preset-icon";
import { connection } from "next/server";
import { getSiteConfig } from "@/lib/site-config";
import { getSeoSettings } from "@/lib/seo-settings";
import { cookies } from "next/headers";
import { AppearanceSwitch } from "@/components/appearance-switch";
import { getThemeSelection } from "@/lib/theme-selection";

export async function generateMetadata(): Promise<Metadata> {
  await connection();
  const site = getSiteConfig();
  const search = getSeoSettings();
  return {
    title: site.name,
    description: search.description,
    icons: site.iconUrl ? { icon: site.iconUrl } : undefined,
    verification: {
      google: search.googleVerification ?? undefined,
      other: search.bingVerification ? { "msvalidate.01": search.bingVerification } : undefined,
    },
  };
}

export const instant = false;

export default async function RootLayout({ children }: LayoutProps<"/">) {
  await connection();
  const preset = getThemePreset();
  const selection = getThemeSelection();
  const site = getSiteConfig();
  const savedMode = (await cookies()).get("site_appearance")?.value;
  const presetMode = preset.mode === "light" || preset.mode === "dark" ? preset.mode : "system";
  const mode = savedMode === "light" || savedMode === "dark" ? savedMode : presetMode;
  const presetCode = (Object.keys(themeOptions) as (keyof typeof themeOptions)[])
    .map((field) => preset[field]).join(".");

  return (
    <html lang="en" className={mode === "dark" ? "dark" : ""} data-mode={mode} data-site-preset={presetCode}
      data-theme={selection.themeId} data-template={selection.templateId}>
      <head><style id="site-preset">{presetCss(preset, ":root")}</style><link rel="stylesheet" href="/theme.css" /></head>
      <body>
        <header className="border-b" style={{ background: "var(--sidebar)", color: "var(--sidebar-foreground)", borderColor: "var(--sidebar-border)" }}>
          <nav className="mx-auto flex w-full max-w-[1400px] flex-wrap items-center justify-between gap-2 px-6 py-4" aria-label="Main navigation">
            <Link href="/" className="inline-flex min-w-0 items-center gap-2 break-words font-semibold tracking-tight">
              {/* Operator assets can use any host, so a fixed image optimizer allowlist would block valid sites. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {site.logoUrl && <img src={site.logoUrl} alt="" className="size-7 object-contain" />}
              {site.name}
            </Link>
            <div className="flex w-full flex-wrap items-center gap-1 sm:w-auto sm:gap-2">
              <Link href="/owner/listings" className="rounded-md px-3 py-2 text-sm">Submit a link</Link>
              <Link href="/articles" className="rounded-md px-3 py-2 text-sm">Articles</Link>
              <Link href="/listings" className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm" style={{ background: "var(--sidebar-accent)", color: "var(--sidebar-accent-foreground)" }}>Listings <PresetExternalLinkIcon library={preset.iconLibrary} /></Link>
              <AppearanceSwitch initialMode={mode} />
            </div>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
