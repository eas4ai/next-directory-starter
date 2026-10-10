import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { canEditArticles, canModerate, sessionUser } from "@/lib/admin";
import { ownerListings } from "@/lib/moderation";
import { getSiteConfig } from "@/lib/site-config";
import { OwnerEditor } from "./owner-editor";
import { listOwnerNotifications } from "@/lib/notifications";

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
    <main className="mx-auto w-full max-w-[1400px] px-6 py-10">
      <Link href="/listings" className="text-sm text-muted-foreground hover:text-foreground">← Directory</Link>
      <h1 className="mt-7 text-3xl font-semibold tracking-tight">My listings</h1>
      <p className="mt-3 text-muted-foreground">Save drafts, submit them for review, and propose updates to approved listings.</p>
      <Link href="/owner/billing" className="mt-3 inline-block text-sm underline">My billing</Link>
      {canModerate(user.role) && <Link href="/admin/review" className="mt-3 inline-block text-sm underline">Review submissions</Link>}
      {canEditArticles(user.role) && <Link href="/admin/articles" className="ml-4 mt-3 inline-block text-sm underline">Edit articles</Link>}
      <OwnerEditor initialListings={ownerListings(user.id)} />
      <section className="mt-12" aria-label="Owner notifications">
        <h2 className="text-2xl font-semibold">Notifications</h2>
        <p className="mt-2 text-sm text-muted-foreground">Your latest moderation and payment updates.</p>
        <div className="mt-5 space-y-3">
          {listOwnerNotifications(user.id).map((notice) => (
            <article key={notice.id} className="rounded-lg border p-4">
              <h3 className="font-medium">{notice.subject}</h3>
              <p className="mt-1 text-sm">{notice.body}</p>
              <time className="mt-2 block text-xs text-muted-foreground" dateTime={notice.createdAt}>
                {new Date(notice.createdAt).toLocaleString("en-US", { timeZone: "UTC" })} UTC
              </time>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
