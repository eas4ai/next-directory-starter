import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { isAdmin } from "@/lib/admin";
import { getSiteConfig } from "@/lib/site-config";
import { BrandingEditor } from "./branding-editor";

export const metadata: Metadata = {
  title: "Branding", description: "Administrator branding settings.",
  robots: { index: false, follow: false },
};

export default async function BrandingPage() {
  await connection();
  if (!(await isAdmin(await headers()))) notFound();
  const brand = getSiteConfig();
  return (
    <main className="site-container">
      <p className="text-sm font-medium text-muted-foreground">Site settings</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">Branding</h1>
      <p className="mt-3 max-w-3xl text-muted-foreground">Set the name and images used across the directory. Published content and search image choices keep their own priority.</p>
      <Link href="/admin/theme" className="mt-3 inline-block text-sm underline">Theme and templates</Link>
      <section aria-label="Current brand preview" className="mt-8 grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border bg-card p-6">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {brand.logoUrl && <img src={brand.logoUrl} alt="" className="size-12 object-contain" />}
            <strong className="text-xl">{brand.name}</strong>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">{brand.description}</p>
        </div>
        <div className="rounded-lg border bg-card p-6">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Current images</p>
          <div className="mt-4 flex items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {brand.iconUrl && <img src={brand.iconUrl} alt="Favicon preview" className="size-12 object-contain" />}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {brand.socialImage && <img src={brand.socialImage} alt="Default social image preview" className="h-20 max-w-40 object-contain" />}
            {!brand.iconUrl && !brand.socialImage && <span className="text-sm text-muted-foreground">No images configured</span>}
          </div>
        </div>
      </section>
      <BrandingEditor initial={brand} />
    </main>
  );
}
