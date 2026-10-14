import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { canAdmin, canOpenOverview, sessionUser } from "@/lib/admin";
import { overviewData, overviewDestinations, type Overview } from "@/lib/overview";
import { getSiteConfig } from "@/lib/site-config";

export async function generateMetadata(): Promise<Metadata> {
  await connection();
  return {
    title: `Administration overview | ${getSiteConfig().name}`,
    description: "Current publication and review work.",
    robots: { index: false, follow: false },
  };
}

export default async function OverviewPage() {
  await connection();
  const user = await sessionUser(await headers());
  if (!canOpenOverview(user?.role)) notFound();
  let overview: Overview | null = null;
  try {
    overview = overviewData(canAdmin(user?.role));
  } catch (error) {
    console.error("Administration overview unavailable", error);
  }
  const destinations = overviewDestinations(user?.role);
  return (
    <main className="mx-auto w-full theme-page-width px-5 py-10 sm:px-8">
      <h1 className="text-3xl font-semibold tracking-tight">Administration overview</h1>
      <p className="mt-3 text-muted-foreground">Current public content and review work.</p>
      {overview ? (
        <>
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {([
              ["Published listings", overview.publicListings],
              ["Published articles", overview.publishedArticles],
              ["Pending submissions", overview.pendingSubmissions],
            ] as const).map(([label, count]) => (
              <section key={label} className="rounded-lg border bg-card p-5">
                <h2 className="text-sm font-medium text-muted-foreground">{label}</h2>
                <p className="mt-3 text-3xl font-semibold tabular-nums">{count}</p>
              </section>
            ))}
          </div>
          {overview.recentActivity && (
            <section className="mt-10" aria-labelledby="recent-activity-title">
              <h2 id="recent-activity-title" className="text-xl font-semibold">Recent activity</h2>
              {overview.recentActivity.length ? (
                <ol className="mt-4 space-y-3">
                  {overview.recentActivity.map((event) => (
                    <li key={event.id} className="min-w-0 rounded-lg border p-4 text-sm">
                      <p className="font-medium break-all">{event.action} · {event.target}</p>
                      <p className="mt-1 text-muted-foreground break-all">
                        {event.actorUserId} · <time dateTime={event.occurredAt}>{event.occurredAt}</time>
                      </p>
                    </li>
                  ))}
                </ol>
              ) : <p className="mt-4 text-sm text-muted-foreground">No protected changes recorded yet.</p>}
            </section>
          )}
        </>
      ) : (
        <p role="alert" className="mt-8 rounded-lg border border-destructive p-5 text-destructive">
          Overview data is unavailable. Try again shortly.
        </p>
      )}
      <nav className="mt-10" aria-label="Administration destinations">
        <h2 className="text-xl font-semibold">Your workspaces</h2>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {destinations.map(({ href, label }) => (
            <li key={href}><Link href={href} className="block rounded-lg border p-4 font-medium underline underline-offset-4 hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">{label}</Link></li>
          ))}
        </ul>
      </nav>
    </main>
  );
}
