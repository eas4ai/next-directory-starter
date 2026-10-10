import Link from "next/link";
import { Button } from "@/components/ui/button";
import { connection } from "next/server";
import { pageMetadata } from "@/lib/page-metadata";
import { getSiteConfig } from "@/lib/site-config";
import { JsonLd } from "@/components/json-ld";
import { publicUrl } from "@/lib/page-metadata";
import { getSeoSettings } from "@/lib/seo-settings";

export async function generateMetadata() {
  await connection();
  const site = getSiteConfig();
  return pageMetadata("/", site.name, getSeoSettings().description);
}

export default function Home() {
  const site = getSiteConfig();
  return (
    <main className="site-container template-hero flex min-h-[70vh] flex-col justify-center">
      <JsonLd data={{
        "@context": "https://schema.org", "@type": "WebSite",
        name: site.name, description: site.description, url: publicUrl("/"),
      }} />
      <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">{site.name}</p>
      <h1 className="mt-5 max-w-3xl text-5xl font-semibold tracking-tight">The useful links, all in one place.</h1>
      <p className="mt-6 max-w-xl text-lg text-muted-foreground">{site.description}</p>
      <div className="mt-8"><Button asChild><Link href="/listings">Browse listings</Link></Button></div>
    </main>
  );
}
