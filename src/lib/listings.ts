export type Listing = {
  slug: string;
  name: string;
  summary: string;
  description: string;
  category: string;
  url: string;
  status: "published" | "draft";
};

// Replace these examples with your directory's own source of listings.
export const sampleListings: Listing[] = [
  {
    slug: "example-tool",
    name: "Example Tool",
    summary: "A sample link for your directory",
    description: "Example Tool is a sample listing that shows how a published link appears in the directory.",
    category: "Tools",
    url: "https://example.org/tool",
    status: "published",
  },
  {
    slug: "hidden-draft",
    name: "Hidden Draft",
    summary: "A draft listing that is not public",
    description: "This sample is reserved for testing publication rules.",
    category: "Tools",
    url: "https://example.org/draft",
    status: "draft",
  },
];

export const publishedListings = sampleListings.filter((listing) => listing.status === "published");

export function publishedListingBySlug(slug: string): Listing | undefined {
  return publishedListings.find((listing) => listing.slug === slug);
}
