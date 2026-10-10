import type { Listing } from "@/lib/listings";
import type { Article } from "@/lib/articles";
import { publicUrl } from "@/lib/page-metadata";

const plain = (value: string): string => value.replace(/([\\`*_{}\[\]()#+.!|>~-])/g, "\\$1");

export function listingMarkdown(listing: Listing): string {
  return [
    `# ${plain(listing.name)}`,
    plain(listing.summary),
    `Canonical: ${publicUrl(`/listings/${listing.slug}`)}`,
    `Category: ${plain(listing.category)}`,
    `Website: ${listing.url}`,
    listing.description,
  ].join("\n\n") + "\n";
}

export function articleMarkdown(article: Article): string {
  return [
    `# ${plain(article.title)}`,
    plain(article.summary),
    `Canonical: ${publicUrl(`/articles/${article.slug}`)}`,
    ...(article.category ? [`Category: ${plain(article.category)}`] : []),
    ...(article.tags.length ? [`Tags: ${article.tags.map(plain).join(", ")}`] : []),
    article.body,
  ].join("\n\n") + "\n";
}

export const markdownHeaders = {
  "Content-Type": "text/markdown; charset=utf-8",
  "Cache-Control": "public, max-age=60",
  "X-Robots-Tag": "noindex, nofollow",
  "X-Content-Type-Options": "nosniff",
};
