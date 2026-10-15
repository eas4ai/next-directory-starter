import type { ComponentProps, ReactNode } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ContentImage } from "@/components/content-image";
import { MarkdownContent } from "@/components/markdown-content";
import { PresetExternalLinkIcon } from "@/components/preset-icon";
import { ProfileValuesView } from "@/components/profile-values-view";
import type {
  PublicTemplateListing, PublicTemplateListingDetailProps, PublicTemplatePagination,
} from "@/lib/public-template-sdk";
import type { DirectoryProfileField } from "@/lib/directory-profile-types";
import type { MediaAsset } from "@/lib/media";

export function TemplateLink(props: ComponentProps<typeof Link>) {
  return <Link {...props} />;
}

export function TemplateProfileValues({ fields, listing, mediaAssets, placements }: {
  fields: readonly DirectoryProfileField[];
  listing: PublicTemplateListing;
  mediaAssets: ReadonlyMap<string, MediaAsset>;
  placements?: readonly DirectoryProfileField["placement"][];
}) {
  return <ProfileValuesView fields={[...fields]} values={listing.profileValues}
    mediaAssets={mediaAssets} placements={placements ? [...placements] : undefined} />;
}

export function TemplateListingCard({ listing, fields, mediaAssets, iconLibrary,
  highlighted = false, compareControl }: {
  listing: PublicTemplateListing;
  fields: readonly DirectoryProfileField[];
  mediaAssets: ReadonlyMap<string, MediaAsset>;
  iconLibrary: string;
  highlighted?: boolean;
  compareControl?: ReactNode;
}) {
  return <Card className={`template-listing-card min-w-0 ${highlighted ? "border-primary/50" : ""}`}>
    <CardHeader>
      {highlighted && <span className="w-fit rounded-full bg-primary px-2 py-1 text-xs font-semibold text-primary-foreground">
        Featured
      </span>}
      <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
        {listing.category}{listing.featured && !highlighted ? " · Featured" : ""}
      </p>
      <CardTitle><Link href={`/listings/${listing.slug}`}
        className="inline-flex max-w-full items-center gap-1 wrap-anywhere hover:underline">
        {listing.name}<PresetExternalLinkIcon library={iconLibrary} />
      </Link></CardTitle>
    </CardHeader>
    <CardContent className="min-w-0">
      <p className="text-muted-foreground">{listing.summary}</p>
      <TemplateProfileValues fields={fields} listing={listing} mediaAssets={mediaAssets}
        placements={["badge", "card"]} />
      {compareControl}
    </CardContent>
  </Card>;
}

export function TemplatePagination({ value }: { value: PublicTemplatePagination }) {
  if (value.pages <= 1) return null;
  return <nav className="template-pagination mt-8 flex items-center justify-between gap-4"
    aria-label="Listing pages">
    {value.previousHref ? <Button variant="outline" asChild>
      <Link href={value.previousHref}>Previous</Link>
    </Button> : <span />}
    <span className="text-sm text-muted-foreground">Page {value.page} of {value.pages}</span>
    {value.nextHref ? <Button variant="outline" asChild>
      <Link href={value.nextHref}>Next</Link>
    </Button> : <span />}
  </nav>;
}

export function TemplateListingDetailBody({ value }: {
  value: PublicTemplateListingDetailProps;
}) {
  const { listing, fields, mediaAssets, image, markdownHref, iconLibrary } = value;
  return <>
    <Link href="/listings" className="text-sm text-muted-foreground hover:text-foreground">← Listings</Link>
    <a href={markdownHref} type="text/markdown" rel="alternate"
      className="ml-4 text-sm underline">Markdown version</a>
    <p className="mt-10 text-sm font-medium uppercase tracking-widest text-muted-foreground">
      {listing.category}
    </p>
    {listing.featured && <p className="mt-3 w-fit rounded-full bg-primary px-2 py-1 text-xs font-semibold text-primary-foreground">
      Featured
    </p>}
    <h1 className="mt-3 text-4xl font-semibold tracking-tight">{listing.name}</h1>
    <p className="mt-5 text-lg text-muted-foreground">{listing.summary}</p>
    {image && <div className="mt-8"><ContentImage asset={image} /></div>}
    <div className="mt-8"><MarkdownContent source={listing.description} /></div>
    <section className="mt-8 min-w-0" aria-label="Listing details">
      <TemplateProfileValues fields={fields} listing={listing} mediaAssets={mediaAssets} />
    </section>
    <div className="mt-8"><Button asChild
      className="h-auto min-h-8 max-w-full whitespace-normal wrap-anywhere text-center">
      <a href={listing.url} target="_blank" rel="noopener noreferrer">
        Visit {listing.name} <PresetExternalLinkIcon library={iconLibrary} />
      </a>
    </Button></div>
  </>;
}
