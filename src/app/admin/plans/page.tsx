import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { canManageBilling, sessionUser } from "@/lib/admin";
import { listPlans } from "@/lib/plans";
import { getSiteConfig } from "@/lib/site-config";
import { PlanEditor } from "./plan-editor";

export async function generateMetadata(): Promise<Metadata> {
  await connection();
  return {
    title: `Publishing plans | ${getSiteConfig().name}`,
    description: "Private publishing plan controls.",
    robots: { index: false, follow: false },
  };
}

export default async function PlansPage() {
  await connection();
  if (!canManageBilling((await sessionUser(await headers()))?.role)) notFound();
  return (
    <main className="mx-auto w-full theme-page-width px-6 py-10">
      <Link href="/admin/overview" className="text-sm text-muted-foreground hover:text-foreground">← Overview</Link>
      <h1 className="mt-7 text-3xl font-semibold tracking-tight">Publishing plans</h1>
      <p className="mt-3 text-muted-foreground">Set prices, durations, and featured placement for approved listing owners.</p>
      <PlanEditor initialPlans={listPlans()} />
    </main>
  );
}
