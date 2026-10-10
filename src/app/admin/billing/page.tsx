import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { isAdmin } from "@/lib/admin";
import { listBillingProfiles } from "@/lib/billing-profiles";
import { getSiteConfig } from "@/lib/site-config";
import { BillingEditor } from "./billing-editor";

export async function generateMetadata(): Promise<Metadata> {
  await connection();
  return {
    title: `Billing providers | ${getSiteConfig().name}`,
    description: "Private payment provider settings.",
    robots: { index: false, follow: false },
  };
}

export default async function BillingPage() {
  await connection();
  if (!(await isAdmin(await headers()))) notFound();
  return (
    <main className="mx-auto w-full max-w-[1400px] px-6 py-10">
      <Link href="/admin/catalog" className="text-sm text-muted-foreground hover:text-foreground">← Catalog</Link>
      <h1 className="mt-7 text-3xl font-semibold tracking-tight">Billing providers</h1>
      <p className="mt-3 max-w-3xl text-muted-foreground">Save test and live settings separately. Secrets are write-only; leave a secret field blank to keep its saved value. Provider profiles start disabled.</p>
      <BillingEditor initialProfiles={listBillingProfiles()} />
    </main>
  );
}
