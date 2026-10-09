import records from "../../fixtures/sample-listings.json";

export type Listing = {
  slug: string;
  name: string;
  summary: string;
  description: string;
  category: string;
  url: string;
  status: "published" | "draft";
};

export const sampleListings: Listing[] = records.map((record): Listing => {
  if (record.status !== "published" && record.status !== "draft") {
    throw new Error(`Unknown status for listing ${record.slug}`);
  }
  return {
    slug: record.slug,
    name: record.title,
    summary: record.summary,
    description: record.description,
    category: record.category,
    url: record.url,
    status: record.status,
  };
});

export const publishedListings = sampleListings.filter((listing) => listing.status === "published");

export function publishedListingBySlug(slug: string): Listing | undefined {
  return publishedListings.find((listing) => listing.slug === slug);
}
