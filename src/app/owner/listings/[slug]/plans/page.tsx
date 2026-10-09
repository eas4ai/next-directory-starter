import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { sessionUser } from "@/lib/admin";
import { ownerListing } from "@/lib/moderation";
import { listPlans, planPrice } from "@/lib/plans";
import { getSiteConfig } from "@/lib/site-config";
import { CheckoutButton } from "./checkout-button";

export async function generateMetadata(): Promise<Metadata> {
  await connection();
  return {
    title: `Publishing plans | ${getSiteConfig().name}`,
    description: "Private listing publishing options.",
    robots: { index: false, follow: false },
  };
}

export default async function ListingPlansPage({ params, searchParams }: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ checkout?: string }>;
}) {
  await connection();
  const user = await sessionUser(await headers());
  if (!user) redirect("/owner/sign-in");
  const { slug } = await params;
  let listing;
  try { listing = ownerListing(user.id, slug).listing; }
  catch { notFound(); }
  if (listing.status !== "published") notFound();
  const plans = listPlans(true);
  const checkout = (await searchParams).checkout;
  return (
    <main className="mx-auto w-full max-w-[1400px] px-6 py-10">
      <Link href="/owner/listings" className="text-sm text-muted-foreground hover:text-foreground">← My listings</Link>
      <h1 className="mt-7 text-3xl font-semibold tracking-tight">Publishing plans for {listing.name}</h1>
      <p className="mt-3 text-muted-foreground">Review the price, duration, and placement before continuing to Stripe Checkout.</p>
      {checkout === "return" && <p role="status" className="mt-4 rounded-md border p-3 text-sm">Checkout returned. Publication benefits begin after payment is confirmed.</p>}
      {checkout === "cancel" && <p role="status" className="mt-4 rounded-md border p-3 text-sm">Checkout was cancelled. No new benefit was started.</p>}
      <section className="mt-8 grid gap-4 md:grid-cols-2" aria-label="Available publishing plans">
        {plans.map((plan) => (
          <article key={plan.key} className="flex flex-col gap-3 rounded-lg border p-6">
            <h2 className="text-xl font-semibold">{plan.name}</h2>
            {plan.description && <p className="text-sm text-muted-foreground">{plan.description}</p>}
            <p className="text-2xl font-semibold">{planPrice(plan)}</p>
            <p className="text-sm">{`${plan.durationDays} days · ${plan.featured ? "Featured placement" : "Standard placement"}`}</p>
            <CheckoutButton slug={slug} planKey={plan.key} />
          </article>
        ))}
      </section>
      {plans.length === 0 && <p className="mt-8 text-sm text-muted-foreground">No publishing plans are available right now.</p>}
    </main>
  );
}
