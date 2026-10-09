import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { directoryCategories, searchPublishedListings } from "@/lib/listings";
import { getThemePreset } from "@/lib/theme";
import { PresetExternalLinkIcon } from "@/components/preset-icon";
import { connection } from "next/server";
import { pageMetadata, publicUrl } from "@/lib/page-metadata";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getSiteConfig } from "@/lib/site-config";
import { JsonLd } from "@/components/json-ld";

export async function generateMetadata({ searchParams }: PageProps<"/listings">) {
  await connection();
  const hasQuery = Object.keys(await searchParams).length > 0;
  return {
    ...pageMetadata("/listings", `Listings | ${getSiteConfig().name}`, "Explore the published links in this directory."),
    ...(hasQuery ? { robots: { index: false, follow: true } } : {}),
  };
}

function one(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : Array.isArray(value) ? value[0] ?? "" : "";
}

export default async function ListingsPage({ searchParams }: PageProps<"/listings">) {
  const params = await searchParams;
  const q = one(params.q).trim().slice(0, 120);
  const category = one(params.category).trim().slice(0, 80);
  const page = one(params.page);
  const result = searchPublishedListings({ q, category, page });
  const categories = directoryCategories();
  const selectedCategory = categories.find((item) => item.toLowerCase() === category.toLowerCase()) ?? category;
  const unknownCategory = Boolean(category) && !categories.includes(selectedCategory);
  const preset = getThemePreset();
  const pageHref = (number: number) => {
    const query = new URLSearchParams();
    if (q) query.set("q", q);
    if (category) query.set("category", category);
    query.set("page", String(number));
    return `/listings?${query}`;
  };

  return (
    <main className="mx-auto w-full max-w-[1400px] wrap-anywhere px-6 py-12">
      <JsonLd data={{
        "@context": "https://schema.org", "@type": "CollectionPage",
        name: "Listings", description: "Explore the published links in this directory.",
        url: publicUrl("/listings"),
        mainEntity: { "@type": "ItemList", itemListElement: result.listings.map((listing, index) => ({
          "@type": "ListItem", position: index + 1,
          name: listing.name, url: publicUrl(`/listings/${listing.slug}`),
        })) },
      }} />
      <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">← Home</Link>
      <div className="mt-8">
        <h1 className="text-4xl font-semibold tracking-tight">Listings</h1>
        <p className="mt-3 max-w-2xl text-muted-foreground">Explore the published links in this directory.</p>
      </div>
      <form action="/listings" method="get" className="mt-8 grid gap-3 rounded-lg border p-4 sm:grid-cols-[1fr_12rem_auto] sm:items-end">
        <label className="grid gap-2 text-sm font-medium" htmlFor="directory-query">
          Search
          <Input id="directory-query" name="q" defaultValue={q} placeholder="Search listings" />
        </label>
        <label className="grid gap-2 text-sm font-medium" htmlFor="directory-category">
          Category
          <select id="directory-category" name="category" defaultValue={selectedCategory} className="h-9 rounded-md border border-input bg-background px-3 text-sm">
            <option value="">All categories</option>
            {unknownCategory && <option value={selectedCategory}>Unknown category: {selectedCategory}</option>}
            {categories.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <Button type="submit">Find links</Button>
      </form>
      <p className="mt-6 text-sm text-muted-foreground" role="status">{result.total} {result.total === 1 ? "listing" : "listings"} found</p>
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {result.listings.map((listing) => (
          <Card key={listing.slug}>
            <CardHeader>
              <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">{listing.category}</p>
              <CardTitle><Link href={`/listings/${listing.slug}`} className="inline-flex items-center gap-1 hover:underline">{listing.name}<PresetExternalLinkIcon library={preset.iconLibrary} /></Link></CardTitle>
            </CardHeader>
            <CardContent><p className="text-muted-foreground">{listing.summary}</p></CardContent>
          </Card>
        ))}
      </div>
      {result.listings.length === 0 && <p className="mt-6 text-muted-foreground">No listings match these filters.</p>}
      {result.pages > 1 && (
        <nav className="mt-8 flex items-center justify-between gap-4" aria-label="Listing pages">
          {result.page > 1 ? <Button variant="outline" asChild><Link href={pageHref(result.page - 1)}>Previous</Link></Button> : <span />}
          <span className="text-sm text-muted-foreground">Page {result.page} of {result.pages}</span>
          {result.page < result.pages ? <Button variant="outline" asChild><Link href={pageHref(result.page + 1)}>Next</Link></Button> : <span />}
        </nav>
      )}
    </main>
  );
}
