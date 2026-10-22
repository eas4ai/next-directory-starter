export function normalizeListingDestination(value: string): string {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || !url.hostname ||
      url.username || url.password || value.length > 2048) {
    throw new Error("Invalid listing destination URL");
  }
  url.hash = "";
  return url.href;
}
