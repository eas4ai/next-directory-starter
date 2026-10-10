import type { Metadata } from "next";
import { headers } from "next/headers";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { canAdmin, sessionUser } from "@/lib/admin";
import { getSeoSettings } from "@/lib/seo-settings";
import { SeoSettingsEditor } from "./settings-editor";
import { listNotFound, listRedirects } from "@/lib/seo-redirects";
import { RedirectEditor } from "./redirect-editor";
import { seoFindings, seoPreview, type SeoPreview } from "@/lib/seo-findings";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Search settings", robots: { index: false, follow: false },
};

export default async function SeoAdminPage({ searchParams }: {
  searchParams: Promise<{ page?: string; kind?: string; slug?: string }>;
}) {
  await connection();
  const user = await sessionUser(await headers());
  if (!canAdmin(user?.role)) notFound();
  const query = await searchParams;
  const findings = seoFindings(Number(query.page ?? "1"));
  const kind = query.kind === "listing" || query.kind === "article" ? query.kind : "home";
  let preview: SeoPreview | null = null;
  try { preview = seoPreview(kind, query.slug); }
  catch { /* show a missing-content hint below */ }
  const href = (page: number) => {
    const values = new URLSearchParams({ page: String(page), kind });
    if (query.slug) values.set("slug", query.slug);
    return `/admin/seo?${values}`;
  };
  return (
    <main className="mx-auto w-full theme-page-width px-6 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Search settings</h1>
      <p className="mt-3 max-w-3xl text-muted-foreground">Set public search defaults and verify site ownership.</p>
      <SeoSettingsEditor initial={getSeoSettings()} />
      <section className="mt-10 grid gap-8 lg:grid-cols-2">
        <div className="min-w-0 space-y-4">
          <h2 className="text-xl font-semibold">Search findings</h2>
          <p className="text-sm text-muted-foreground">Checks use current public pages. Page {findings.page} of {findings.pages} examines up to 40 items. These are actions to review, not a ranking score.</p>
          <ul className="space-y-3">
            {findings.findings.map((finding, index) => <li key={`${finding.path}-${finding.code}-${index}`} className="rounded-md border p-4 text-sm">
              <p className="font-medium">{finding.path}: {finding.message}</p>
              <p className="mt-1 text-muted-foreground">{finding.action}</p>
              <Link href={finding.editPath} className="mt-2 inline-block underline">Open editor</Link>
            </li>)}
            {findings.findings.length === 0 && <li className="text-sm text-muted-foreground">No findings on this page.</li>}
          </ul>
          {findings.pages > 1 && <nav className="flex items-center justify-between text-sm" aria-label="SEO finding pages">
            {findings.page > 1 ? <Link href={href(findings.page - 1)} className="underline">Previous</Link> : <span />}
            <span>Page {findings.page} of {findings.pages}</span>
            {findings.page < findings.pages ? <Link href={href(findings.page + 1)} className="underline">Next</Link> : <span />}
          </nav>}
        </div>
        <div className="min-w-0 space-y-4">
          <h2 className="text-xl font-semibold">Current public preview</h2>
          <form action="/admin/seo" method="get" className="grid gap-3 rounded-md border p-4">
            <label className="grid gap-2 text-sm font-medium">Page type
              <select name="kind" defaultValue={kind} className="h-9 rounded-md border border-input bg-background px-3 text-sm">
                <option value="home">Home</option><option value="listing">Listing</option><option value="article">Article</option>
              </select>
            </label>
            <label className="grid gap-2 text-sm font-medium">Published slug
              <input name="slug" defaultValue={query.slug ?? ""} maxLength={80} placeholder="example-tool"
                className="h-9 rounded-md border border-input bg-background px-3 text-sm" />
            </label>
            <button type="submit" className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">Show preview</button>
          </form>
          {preview ? <div className="space-y-4 rounded-md border p-4 text-sm">
            <div><p className="text-xs uppercase tracking-wide text-muted-foreground">Search result</p>
              <p className="mt-2 break-words font-medium">{preview.search.title}</p>
              <p className="break-all text-muted-foreground">{preview.search.canonical}</p>
              <p className="mt-1">{preview.search.description}</p>
              <p className="mt-1 text-muted-foreground">Indexing: {preview.search.indexable ? "allowed" : "noindex"}</p></div>
            <div className="border-t pt-4"><p className="text-xs uppercase tracking-wide text-muted-foreground">Social card</p>
              <p className="mt-2 break-words font-medium">{preview.social.title}</p>
              <p className="mt-1">{preview.social.description}</p>
              <p className="mt-1 break-all text-muted-foreground">Image: {preview.social.image ?? "No image configured"}</p></div>
          </div> : <p className="text-sm text-muted-foreground">Select an eligible public slug to preview it.</p>}
        </div>
      </section>
      <RedirectEditor initial={listRedirects()} paths={listNotFound()} />
    </main>
  );
}
