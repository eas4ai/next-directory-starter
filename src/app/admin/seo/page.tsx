import type { Metadata } from "next";
import { headers } from "next/headers";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { canAdmin, sessionUser } from "@/lib/admin";
import { getSeoSettings } from "@/lib/seo-settings";
import { SeoSettingsEditor } from "./settings-editor";
import { listNotFound, listRedirects } from "@/lib/seo-redirects";
import { RedirectEditor } from "./redirect-editor";

export const metadata: Metadata = {
  title: "Search settings", robots: { index: false, follow: false },
};

export default async function SeoAdminPage() {
  await connection();
  const user = await sessionUser(await headers());
  if (!canAdmin(user?.role)) notFound();
  return (
    <main className="mx-auto w-full max-w-[1400px] px-6 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Search settings</h1>
      <p className="mt-3 max-w-3xl text-muted-foreground">Set public search defaults and verify site ownership.</p>
      <SeoSettingsEditor initial={getSeoSettings()} />
      <RedirectEditor initial={listRedirects()} paths={listNotFound()} />
    </main>
  );
}
