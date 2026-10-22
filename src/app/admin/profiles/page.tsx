import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { canAdmin, sessionUser } from "@/lib/admin";
import {
  activeDirectoryProfiles, availableDirectoryProfiles, directoryProfileState,
} from "@/lib/directory-profiles";
import { getSiteConfig } from "@/lib/site-config";
import { ProfileManager } from "./profile-manager";

export async function generateMetadata(): Promise<Metadata> {
  await connection();
  return {
    title: `Directory profiles | ${getSiteConfig().name}`,
    description: "Versioned directory fields and lifecycle controls.",
    robots: { index: false, follow: false },
  };
}

export default async function ProfilesPage() {
  await connection();
  const user = await sessionUser(await headers());
  if (!canAdmin(user?.role)) notFound();
  return (
    <main className="mx-auto w-full theme-page-width px-5 py-10 sm:px-8">
      <div className="max-w-3xl">
        <p className="text-sm font-medium text-muted-foreground">Site settings</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Directory profiles</h1>
        <p className="mt-3 text-muted-foreground">
          Activate immutable profile versions, inspect migrations, and manage fields owned by this site.
        </p>
        <div className="mt-3 flex gap-4 text-sm">
          <Link href="/admin/catalog" className="underline">Manage listings</Link>
          <Link href="/admin/overview" className="underline">Administration overview</Link>
        </div>
      </div>
      <ProfileManager initialState={directoryProfileState()}
        initialProfiles={availableDirectoryProfiles()}
        initialActive={activeDirectoryProfiles().definitions} />
    </main>
  );
}
