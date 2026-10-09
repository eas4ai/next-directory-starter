import Link from "next/link";
import { Button } from "@/components/ui/button";
import { connection } from "next/server";
import { pageMetadata } from "@/lib/page-metadata";
import { getSiteConfig } from "@/lib/site-config";

export async function generateMetadata() {
  await connection();
  const site = getSiteConfig();
  return pageMetadata("/", site.name, site.description);
}

export default function Home() {
  const site = getSiteConfig();
  return (
    <main className="mx-auto flex min-h-[70vh] w-full max-w-[1400px] flex-col justify-center px-6 py-20">
      <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">{site.name}</p>
      <h1 className="mt-5 max-w-3xl text-5xl font-semibold tracking-tight">The useful links, all in one place.</h1>
      <p className="mt-6 max-w-xl text-lg text-muted-foreground">{site.description}</p>
      <div className="mt-8"><Button asChild><Link href="/listings">Browse listings</Link></Button></div>
    </main>
  );
}
