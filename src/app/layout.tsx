import type { Metadata } from "next";
import "./globals.css";
import { getThemePreset, themeOptions } from "@/lib/theme";
import { connection } from "next/server";
import { getSiteConfig } from "@/lib/site-config";
import { getSeoSettings } from "@/lib/seo-settings";
import { cookies } from "next/headers";
import { AppearanceSwitch } from "@/components/appearance-switch";
import { getThemeSelection } from "@/lib/theme-selection";
import { presetFontClasses } from "./preset-fonts";
import { publicTemplateDefinition } from "@/lib/public-template-registry";
import { DefaultPublicFooter, DefaultPublicHeader } from "@/components/public-template-defaults";

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
  const template = publicTemplateDefinition(selection.templateId);
  const Header = template?.renderers.header ?? DefaultPublicHeader;
  const Footer = template?.renderers.footer ?? DefaultPublicFooter;
  const navigation = [
    { href: "/owner/listings", label: "Submit a link" },
    { href: "/articles", label: "Articles" },
    { href: "/listings", label: "Listings", emphasis: "primary" as const },
  ];

  return (
    <html lang="en" className={`${presetFontClasses} ${mode === "dark" ? "dark" : ""}`.trim()} data-mode={mode} data-site-preset={presetCode}
      data-theme={selection.themeId} data-template={selection.templateId}>
      <head><link rel="stylesheet" href="/theme.css" /></head>
      <body>
        <Header site={site} navigation={navigation}
          appearanceControl={<AppearanceSwitch initialMode={mode} />}
          iconLibrary={preset.iconLibrary} />
        {children}
        <Footer site={site} navigation={navigation} />
      </body>
    </html>
  );
}
