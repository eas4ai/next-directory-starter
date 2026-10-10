import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { sessionUser } from "@/lib/admin";
import { getSiteConfig } from "@/lib/site-config";
import { listOwnerBilling } from "@/lib/owner-billing";
import { CancelButton } from "./cancel-button";

export async function generateMetadata(): Promise<Metadata> {
  await connection();
  return { title: `My billing | ${getSiteConfig().name}`,
    description: "Private publishing purchases and subscriptions.",
    robots: { index: false, follow: false } };
}

export default async function OwnerBillingPage() {
  await connection();
  const user = await sessionUser(await headers());
  if (!user) redirect("/owner/sign-in");
  const purchases = listOwnerBilling(user.id);
  return <main className="mx-auto w-full theme-page-width px-6 py-10">
    <Link href="/owner/listings" className="text-sm text-muted-foreground hover:text-foreground">
      ← My listings
    </Link>
    <h1 className="mt-7 text-3xl font-semibold tracking-tight">My billing</h1>
    <p className="mt-3 text-muted-foreground">Payment returns are pending until the provider confirms them. Placement ends when its paid period expires.</p>
    <section aria-label="Publishing purchases" className="mt-8 grid gap-4 md:grid-cols-2">
      {purchases.map((purchase) => <article key={purchase.id} className="min-w-0 rounded-lg border p-6">
        <h2 className="break-words text-xl font-semibold">{purchase.planName || "Publishing plan"}</h2>
        <p className="mt-2 break-words text-sm">For <Link className="underline" href={`/listings/${encodeURIComponent(purchase.listingSlug)}`}>
          {purchase.listingSlug}</Link></p>
        <p className="mt-2 text-sm">{purchase.provider} · {purchase.mode} · {purchase.billingMode} ·
          {" "}{new Intl.NumberFormat("en-US", { style: "currency", currency: purchase.currency.toUpperCase() })
            .format(purchase.amountMinor / 100)}</p>
        <p className="mt-3 font-medium capitalize">{purchase.status.replaceAll("-", " ")}</p>
        {purchase.paidUntil && <p className="mt-1 text-sm text-muted-foreground">
          Paid through {new Date(purchase.paidUntil).toLocaleDateString("en-US", { dateStyle: "medium" })}
        </p>}
        {purchase.status === "pending" && purchase.checkoutUrl &&
          <a className="mt-3 inline-block text-sm underline" href={purchase.checkoutUrl}>Continue hosted checkout</a>}
        {purchase.canCancel && <div className="mt-4"><CancelButton purchaseId={purchase.id} /></div>}
      </article>)}
    </section>
    {purchases.length === 0 && <p className="mt-8 text-sm text-muted-foreground">No purchases yet.</p>}
  </main>;
}
