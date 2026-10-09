import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { canEditArticles, canModerate, sessionUser } from "@/lib/admin";
import { ownerListings } from "@/lib/moderation";
import { getSiteConfig } from "@/lib/site-config";
import { OwnerEditor } from "./owner-editor";

export async function generateMetadata(): Promise<Metadata> {
  await connection();
  return {
    title: `My listings | ${getSiteConfig().name}`,
    description: "Private owner listings and submissions.",
    robots: { index: false, follow: false },
  };
}

export default async function OwnerListingsPage() {
  await connection();
  const user = await sessionUser(await headers());
  if (!user) redirect("/owner/sign-in");
  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <Link href="/listings" className="text-sm text-muted-foreground hover:text-foreground">← Directory</Link>
      <h1 className="mt-7 text-3xl font-semibold tracking-tight">My listings</h1>
      <p className="mt-3 text-muted-foreground">Save drafts, submit them for review, and propose updates to approved listings.</p>
      {canModerate(user.role) && <Link href="/admin/review" className="mt-3 inline-block text-sm underline">Review submissions</Link>}
      {canEditArticles(user.role) && <Link href="/admin/articles" className="ml-4 mt-3 inline-block text-sm underline">Edit articles</Link>}
      <OwnerEditor initialListings={ownerListings(user.id)} />
    </main>
  );
}
