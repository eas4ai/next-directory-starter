import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PresetExternalLinkIcon } from "@/components/preset-icon";
import {
  TemplateListingCard, TemplatePagination, TemplateProfileValues,
} from "@/components/public-template-primitives";
import type {
  PublicTemplateComparisonProps, PublicTemplateDirectoryProps, PublicTemplateEmptyProps,
  PublicTemplateFeaturedProps, PublicTemplateHeaderProps, PublicTemplateHomeProps,
} from "@/lib/public-template-sdk";

export function DefaultPublicHeader({ site, navigation, appearanceControl,
  iconLibrary }: PublicTemplateHeaderProps) {
  return <header className="border-b border-sidebar-border bg-sidebar text-sidebar-foreground">
    <nav className="site-nav flex flex-wrap items-center justify-between gap-2 py-4"
      aria-label="Main navigation">
      <Link href="/" className="inline-flex min-w-0 items-center gap-2 break-words font-semibold tracking-tight">
        {/* Operator assets can use any host, so a fixed image optimizer allowlist would block valid sites. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {site.logoUrl && <img src={site.logoUrl} alt="" className="size-7 object-contain" />}
        {site.name}
      </Link>
      <div className="flex w-full flex-wrap items-center gap-1 sm:w-auto sm:gap-2">
        {navigation.map((item) => <Link key={item.href} href={item.href}
          className={item.emphasis === "primary"
            ? "inline-flex items-center gap-2 rounded-md bg-sidebar-accent px-3 py-2 text-sm text-sidebar-accent-foreground"
            : "rounded-md px-3 py-2 text-sm"}>
          {item.label}{item.emphasis === "primary" &&
            <PresetExternalLinkIcon library={iconLibrary} />}
        </Link>)}
        {appearanceControl}
      </div>
    </nav>
  </header>;
}

export function DefaultPublicFooter() {
  return null;
}

export function DefaultPublicHome({ site }: PublicTemplateHomeProps) {
  return <main className="site-container template-hero flex min-h-[70vh] flex-col justify-center">
    <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">{site.name}</p>
    <h1 className="mt-5 max-w-3xl text-5xl font-semibold tracking-tight">
      The useful links, all in one place.
    </h1>
    <p className="mt-6 max-w-xl text-lg text-muted-foreground">{site.description}</p>
    <div className="mt-8"><Button asChild><Link href="/listings">Browse listings</Link></Button></div>
  </main>;
}

export function DefaultPublicFeatured({ listings, fields, mediaAssets, iconLibrary,
  Card }: PublicTemplateFeaturedProps) {
  if (listings.length === 0) return null;
  return <section aria-label="Featured listings" className="mt-8">
    <h2 className="text-xl font-semibold">Featured listings</h2>
    <p className="mt-1 text-sm text-muted-foreground">Paid placements matching these filters.</p>
    <div className="template-listing-grid mt-4">
      {listings.map((listing) => <Card key={listing.slug} listing={listing}
        fields={fields} mediaAssets={mediaAssets} iconLibrary={iconLibrary} highlighted />)}
    </div>
  </section>;
}

export function DefaultPublicEmpty({ message }: PublicTemplateEmptyProps) {
  return <p className="mt-6 text-muted-foreground">{message}</p>;
}

export function DefaultPublicDirectory(value: PublicTemplateDirectoryProps) {
  const Card = value.slots?.card ?? TemplateListingCard;
  const Featured = value.slots?.featured ?? DefaultPublicFeatured;
  const Empty = value.slots?.empty ?? DefaultPublicEmpty;
  const Pagination = value.slots?.pagination ?? TemplatePagination;
  return <main className="site-container wrap-anywhere">
    <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">← Home</Link>
    <div className="mt-8">
      <h1 className="text-4xl font-semibold tracking-tight">{value.title}</h1>
      <p className="mt-3 max-w-2xl text-muted-foreground">{value.description}</p>
    </div>
    {value.facets}
    <p className="mt-6 text-sm text-muted-foreground" role="status">
      {value.total} {value.total === 1 ? "listing" : "listings"} found
    </p>
    <Featured listings={value.featured} fields={value.fields} mediaAssets={value.mediaAssets}
      iconLibrary={value.iconLibrary} Card={Card} />
    <section aria-label="Directory results" data-testid="ordinary-results"
      className="template-listing-grid mt-8">
      {value.listings.map((listing) => <Card key={listing.slug}
        listing={listing} fields={value.fields} mediaAssets={value.mediaAssets}
        iconLibrary={value.iconLibrary} />)}
    </section>
    {value.listings.length === 0 && <Empty message="No listings match these filters." />}
    <Pagination value={value.pagination} />
  </main>;
}

export function DefaultPublicComparison({ listings, fields,
  mediaAssets, message }: PublicTemplateComparisonProps) {
  return <main className="site-container wrap-anywhere">
    <Link href="/listings" className="text-sm text-muted-foreground hover:text-foreground">
      ← Listings
    </Link>
    <h1 className="mt-8 text-4xl font-semibold tracking-tight">Compare listings</h1>
    {message && <p className="mt-4 text-muted-foreground" role="status">{message}</p>}
    <div className="template-listing-grid mt-8">
      {listings.map((listing) => <article key={listing.slug}>
        <h2 className="text-xl font-semibold"><Link href={`/listings/${listing.slug}`}>
          {listing.name}
        </Link></h2>
        <p className="mt-2 text-muted-foreground">{listing.summary}</p>
        <TemplateProfileValues fields={fields} listing={listing} mediaAssets={mediaAssets} />
      </article>)}
    </div>
  </main>;
}
