import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { canModerate, sessionUser } from "@/lib/admin";
import { searchPublishedListings } from "@/lib/listings";
import { reviewSubmissions } from "@/lib/moderation";
import { getSiteConfig } from "@/lib/site-config";
import { ReviewDecision } from "./review-decision";
import { SuspendButton } from "./suspend-button";
import { assignedMedia } from "@/lib/media";
import { ContentImage } from "@/components/content-image";
import { ProfileValuesView } from "@/components/profile-values-view";
import { activeDirectoryProfiles } from "@/lib/directory-profiles";

export async function generateMetadata(): Promise<Metadata> {
  await connection();
  return {
    title: `Review | ${getSiteConfig().name}`,
    description: "Private submission review.",
    robots: { index: false, follow: false },
  };
}

export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ page?: string; catalogPage?: string }> }) {
  await connection();
  const user = await sessionUser(await headers());
  if (!canModerate(user?.role)) notFound();
  const query = await searchParams;
  const requestedPage = Number(query.page ?? "1");
  const { submissions, page, pages } = reviewSubmissions(requestedPage);
  const published = searchPublishedListings({ page: query.catalogPage });
  const profileFields = activeDirectoryProfiles().definitions.flatMap(({ fields }) => fields);

  return (
    <main className="mx-auto w-full theme-page-width px-6 py-10">
      <Link href={user?.role?.split(",").includes("admin") ? "/admin/catalog" : "/owner/listings"} className="text-sm text-muted-foreground hover:text-foreground">← {user?.role?.split(",").includes("admin") ? "Catalog" : "My listings"}</Link>
      <h1 className="mt-7 text-3xl font-semibold tracking-tight">Submission review</h1>
      <p className="mt-3 text-muted-foreground">Inspect proposed listings and past decisions.</p>
      <Link href="/admin/overview" className="mt-3 inline-block text-sm underline">Administration overview</Link>
      <div className="mt-8 space-y-4">
        {submissions.map((submission) => {
          const draftImage = submission.status === "pending"
            ? assignedMedia("listing", submission.slug, "draft") : undefined;
          const image = draftImage ?? assignedMedia("listing", submission.slug, "public");
          return (
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
            {Object.keys(submission.proposed.profileValues).length > 0 && <div className="mt-4">
              <h3 className="mb-2 text-sm font-semibold">Proposed profile values</h3>
              <ProfileValuesView fields={profileFields} values={submission.proposed.profileValues}
                mode="staff" />
            </div>}
            {(submission.proposedSeo.title || submission.proposedSeo.description ||
              submission.proposedSeo.socialImage || submission.proposedSeo.indexable !== null) && (
              <div className="mt-3 rounded-md border p-3 text-sm">
                <p className="font-medium">Proposed search settings</p>
                <p className="mt-1 text-muted-foreground">Title: {submission.proposedSeo.title || "Default"} · Indexing: {submission.proposedSeo.indexable === null ? "Default" : submission.proposedSeo.indexable ? "Allowed" : "Noindex"}</p>
                {submission.proposedSeo.description && <p className="mt-1">{submission.proposedSeo.description}</p>}
                {submission.proposedSeo.socialImage && <p className="mt-1 break-all text-muted-foreground">Social image: {submission.proposedSeo.socialImage}</p>}
              </div>
            )}
            {image && <div className="mt-4"><ContentImage asset={image} privateView={Boolean(draftImage)} /></div>}
            {submission.status === "pending" ? (
              <ReviewDecision id={submission.id} />
            ) : (
              <p className="mt-4 border-t pt-3 text-sm text-muted-foreground">
                {submission.status} by {submission.decidedByEmail ?? submission.decidedBy} at {submission.decidedAt ? new Date(submission.decidedAt).toLocaleString("en-US", { timeZone: "UTC" }) : "unknown time"} UTC
                {submission.reason ? ` · ${submission.reason}` : ""}
              </p>
            )}
          </section>
          );
        })}
        {submissions.length === 0 && <p className="rounded-lg border p-5 text-muted-foreground">No submissions yet.</p>}
      </div>
      {pages > 1 && (
        <nav className="mt-8 flex items-center justify-between text-sm" aria-label="Review pages">
          {page > 1 ? <Link href={`/admin/review?page=${page - 1}&catalogPage=${published.page}`} className="underline">Previous</Link> : <span />}
          <span>Page {page} of {pages}</span>
          {page < pages ? <Link href={`/admin/review?page=${page + 1}&catalogPage=${published.page}`} className="underline">Next</Link> : <span />}
        </nav>
      )}
      <section className="mt-12" aria-labelledby="published-listings-heading">
        <h2 id="published-listings-heading" className="text-2xl font-semibold">Published listings</h2>
        <p className="mt-2 text-sm text-muted-foreground">Suspend any published listing, including operator entries.</p>
        <div className="mt-5 space-y-4">
          {published.listings.map((listing) => (
            <div key={listing.slug} className="rounded-lg border p-5">
              <p className="font-medium">{listing.name}</p>
              <p className="mt-1 text-sm text-muted-foreground">{listing.slug} · {listing.category}</p>
              <SuspendButton slug={listing.slug} />
            </div>
          ))}
          {published.listings.length === 0 && <p className="rounded-lg border p-5 text-muted-foreground">No published listings.</p>}
        </div>
        {published.pages > 1 && (
          <nav className="mt-6 flex items-center justify-between text-sm" aria-label="Published listing pages">
            {published.page > 1 ? <Link href={`/admin/review?page=${page}&catalogPage=${published.page - 1}`} className="underline">Previous</Link> : <span />}
            <span>Page {published.page} of {published.pages}</span>
            {published.page < published.pages ? <Link href={`/admin/review?page=${page}&catalogPage=${published.page + 1}`} className="underline">Next</Link> : <span />}
          </nav>
        )}
      </section>
    </main>
  );
}
