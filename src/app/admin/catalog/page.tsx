import { headers } from "next/headers";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { canAdmin, canManageCatalog, canModerate, sessionUser } from "@/lib/admin";
import { overviewDestinations } from "@/lib/overview";
import { allListings } from "@/lib/listings";
import { CatalogEditor } from "./catalog-editor";
import { connection } from "next/server";
import { getSiteConfig } from "@/lib/site-config";
import Link from "next/link";
import { activeDirectoryProfiles } from "@/lib/directory-profiles";

export async function generateMetadata(): Promise<Metadata> {
  await connection();
  return {
    title: `Catalog | ${getSiteConfig().name}`,
    description: "Administrator listing controls.",
    robots: { index: false, follow: false },
  };
}

export default async function CatalogPage() {
  const user = await sessionUser(await headers());
  if (!canManageCatalog(user?.role)) notFound();
  const profiles = activeDirectoryProfiles();
  return (
    <main className="mx-auto w-full theme-page-width px-6 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Catalog</h1>
      <p className="mt-3 text-muted-foreground">Create listings and manage their publication state.</p>
      {canAdmin(user?.role) && <p className="mt-2 text-sm text-muted-foreground">
        Administrators define typed fields, discovery behavior, and migrations in{" "}
        <Link href="/admin/profiles" className="underline">Directory profiles</Link>.
      </p>}
      <Link href="/admin/import" className="mt-3 inline-block underline">Agent-assisted imports</Link>
      <nav className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm" aria-label="Administration workspaces">
        <Link href="/admin/overview" className="underline">Administration overview</Link>
        {overviewDestinations(user?.role).filter(({ href }) => href !== "/admin/catalog")
          .map(({ href, label }) => <Link key={href} href={href} className="underline">{label}</Link>)}
      </nav>
      <CatalogEditor initialListings={allListings(!canAdmin(user?.role))}
        canSuspend={canModerate(user?.role)}
        profileFields={profiles.definitions.flatMap(({ fields }) => fields)}
        profileStateRevision={profiles.state.revision} />
    </main>
  );
}
