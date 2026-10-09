import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { canModerate, sessionUser } from "@/lib/admin";
import { reviewSubmissions } from "@/lib/moderation";
import { getSiteConfig } from "@/lib/site-config";
import { ReviewDecision } from "./review-decision";
import { SuspendButton } from "./suspend-button";

export async function generateMetadata(): Promise<Metadata> {
  await connection();
  return {
    title: `Review | ${getSiteConfig().name}`,
    description: "Private submission review.",
    robots: { index: false, follow: false },
  };
}

export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  await connection();
  const user = await sessionUser(await headers());
  if (!canModerate(user?.role)) notFound();
  const requestedPage = Number((await searchParams).page ?? "1");
  const { submissions, page, pages } = reviewSubmissions(requestedPage);

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <Link href={user?.role?.split(",").includes("admin") ? "/admin/catalog" : "/owner/listings"} className="text-sm text-muted-foreground hover:text-foreground">← {user?.role?.split(",").includes("admin") ? "Catalog" : "My listings"}</Link>
      <h1 className="mt-7 text-3xl font-semibold tracking-tight">Submission review</h1>
      <p className="mt-3 text-muted-foreground">Inspect proposed listings and past decisions.</p>
      <div className="mt-8 space-y-4">
        {submissions.map((submission) => (
          <section key={submission.id} className="rounded-lg border p-5" aria-labelledby={`submission-${submission.id}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 id={`submission-${submission.id}`} className="text-lg font-semibold">{submission.proposed.name}</h2>
                <p className="text-sm text-muted-foreground">{submission.slug} · {submission.ownerEmail} · {submission.status}</p>
              </div>
              <p className="text-sm text-muted-foreground">Submitted {new Date(submission.submittedAt).toLocaleString("en-US", { timeZone: "UTC" })} UTC</p>
            </div>
            <p className="mt-3 text-sm">{submission.proposed.summary}</p>
            <p className="mt-2 text-sm text-muted-foreground">{submission.proposed.description}</p>
            <p className="mt-2 text-sm text-muted-foreground">{submission.proposed.category} · <a href={submission.proposed.url} target="_blank" rel="noopener noreferrer" className="underline">{submission.proposed.url}</a></p>
            {submission.status === "pending" ? (
              <ReviewDecision id={submission.id} />
            ) : (
              <p className="mt-4 border-t pt-3 text-sm text-muted-foreground">
                {submission.status} by {submission.decidedByEmail ?? submission.decidedBy} at {submission.decidedAt ? new Date(submission.decidedAt).toLocaleString("en-US", { timeZone: "UTC" }) : "unknown time"} UTC
                {submission.reason ? ` · ${submission.reason}` : ""}
              </p>
            )}
            {submission.listingStatus === "published" && submission.status === "approved" &&
              <SuspendButton slug={submission.slug} />}
          </section>
        ))}
        {submissions.length === 0 && <p className="rounded-lg border p-5 text-muted-foreground">No submissions yet.</p>}
      </div>
      {pages > 1 && (
        <nav className="mt-8 flex items-center justify-between text-sm" aria-label="Review pages">
          {page > 1 ? <Link href={`/admin/review?page=${page - 1}`} className="underline">Previous</Link> : <span />}
          <span>Page {page} of {pages}</span>
          {page < pages ? <Link href={`/admin/review?page=${page + 1}`} className="underline">Next</Link> : <span />}
        </nav>
      )}
    </main>
  );
}
