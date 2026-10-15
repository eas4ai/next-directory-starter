import { connection } from "next/server";
import { pageMetadata } from "@/lib/page-metadata";
import { getSiteConfig } from "@/lib/site-config";
import { JsonLd } from "@/components/json-ld";
import { publicUrl } from "@/lib/page-metadata";
import { getSeoSettings } from "@/lib/seo-settings";
import { getThemeSelection } from "@/lib/theme-selection";
import { publicTemplateDefinition } from "@/lib/public-template-registry";
import { DefaultPublicHome } from "@/components/public-template-defaults";

export async function generateMetadata() {
  await connection();
  const site = getSiteConfig();
  return pageMetadata("/", site.name, getSeoSettings().description);
}

export default function Home() {
  const site = getSiteConfig();
  const definition = publicTemplateDefinition(getThemeSelection().templateId);
  const Renderer = definition?.renderers.home ?? DefaultPublicHome;
  return <>
    <JsonLd data={{
      "@context": "https://schema.org", "@type": "WebSite",
      name: site.name, description: site.description, url: publicUrl("/"),
    }} />
    <Renderer site={site} />
  </>;
}
