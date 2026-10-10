import { canAdmin, canManageCatalog, canModerate, sessionUser } from "@/lib/admin";
import { parseListing } from "@/lib/catalog-input";
import { listingBySlug, updateListing } from "@/lib/listings";

export async function PATCH(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const user = await sessionUser(request.headers);
  if (!user || !canManageCatalog(user.role)) return Response.json({ error: "Forbidden" }, { status: 403 });
  const siteOrigin = new URL(process.env.BETTER_AUTH_URL ?? request.url).origin;
  if (request.headers.get("origin") !== siteOrigin) {
    return Response.json({ error: "Invalid origin" }, { status: 403 });
  }
  const { slug } = await params;
  const existing = listingBySlug(slug, !canAdmin(user.role));
  if (!existing) return Response.json({ error: "Listing not found" }, { status: 404 });
  let changes: unknown;
  try {
    const body = await request.text();
    if (body.length > 8192) throw new Error("Request is too large");
    changes = JSON.parse(body);
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) {
    return Response.json({ error: "Invalid listing" }, { status: 400 });
  }
  const listing = parseListing({ ...existing, ...changes, slug: existing.slug });
  if (!listing) return Response.json({ error: "Invalid listing" }, { status: 400 });
  if (!canModerate(user.role) && (existing.status === "suspended" || listing.status === "suspended")) {
    return Response.json({ error: "Moderation permission required" }, { status: 403 });
  }
  updateListing(listing, user.id);
  return Response.json({ listing });
}
