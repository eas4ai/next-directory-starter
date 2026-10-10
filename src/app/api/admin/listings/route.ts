import { canAdmin, canManageCatalog, canModerate, sessionUser } from "@/lib/admin";
import { parseListing } from "@/lib/catalog-input";
import { allListings, createListing, listingBySlug } from "@/lib/listings";
import { HttpError, httpErrorResponse } from "@/lib/http-error";

export async function GET(request: Request) {
  const user = await sessionUser(request.headers);
  if (!canManageCatalog(user?.role)) return Response.json({ error: "Forbidden" }, { status: 403 });
  return Response.json({ listings: allListings(!canAdmin(user?.role)) });
}

export async function POST(request: Request) {
  const user = await sessionUser(request.headers);
  if (!user || !canManageCatalog(user.role)) return Response.json({ error: "Forbidden" }, { status: 403 });
  const siteOrigin = new URL(process.env.BETTER_AUTH_URL ?? request.url).origin;
  if (request.headers.get("origin") !== siteOrigin) {
    return Response.json({ error: "Invalid origin" }, { status: 403 });
  }
  let input: unknown;
  try {
    const body = await request.text();
    if (body.length > 8192) throw new Error("Request is too large");
    input = JSON.parse(body);
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const listing = parseListing(input);
  if (!listing) return Response.json({ error: "Invalid listing" }, { status: 400 });
  if (listing.status === "suspended" && !canModerate(user.role)) {
    return Response.json({ error: "Moderation permission required" }, { status: 403 });
  }
  if (listingBySlug(listing.slug)) return Response.json({ error: "Slug already exists" }, { status: 409 });
  try {
    createListing(listing, user.id);
  } catch (error) {
    if (error instanceof HttpError) return httpErrorResponse(error);
    if (error instanceof Error && error.message.includes("UNIQUE constraint")) {
      return Response.json({ error: "Slug already exists" }, { status: 409 });
    }
    throw error;
  }
  return Response.json({ listing }, { status: 201 });
}
