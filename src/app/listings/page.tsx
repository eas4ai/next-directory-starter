import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { publishedListings } from "@/lib/listings";
import { getThemePreset } from "@/lib/theme";
import { PresetExternalLinkIcon } from "@/components/preset-icon";
import { connection } from "next/server";
import { pageMetadata } from "@/lib/page-metadata";

export async function generateMetadata() {
  await connection();
  return pageMetadata("/listings", "Listings | Directory Starter", "Explore the published links in this sample directory.");
}

export default function ListingsPage() {
  const preset = getThemePreset();
  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">← Home</Link>
      <div className="mt-8">
        <h1 className="text-4xl font-semibold tracking-tight">Listings</h1>
        <p className="mt-3 max-w-2xl text-muted-foreground">Explore the published links in this sample directory.</p>
      </div>
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {publishedListings.map((listing) => (
          <Card key={listing.slug}>
            <CardHeader>
              <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">{listing.category}</p>
              <CardTitle><Link href={`/listings/${listing.slug}`} className="inline-flex items-center gap-1 hover:underline">{listing.name}<PresetExternalLinkIcon library={preset.iconLibrary} /></Link></CardTitle>
            </CardHeader>
            <CardContent><p className="text-muted-foreground">{listing.summary}</p></CardContent>
          </Card>
        ))}
      </div>
    </main>
  );
}
