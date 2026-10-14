import { canAdmin, canManageCatalog, canModerate, sessionUser } from "@/lib/admin";
import { parseListing } from "@/lib/catalog-input";
import { allListings, createListing, listingBySlug } from "@/lib/listings";
import { HttpError, httpErrorResponse } from "@/lib/http-error";
import { requestJson, requestJsonErrorResponse } from "@/lib/request-json";
import { ProfileValueError } from "@/lib/profile-values";

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
    input = await requestJson(request, 256 * 1024);
  } catch (error) {
    return requestJsonErrorResponse(error);
  }
  const listing = parseListing(input);
  if (!listing) return Response.json({ error: "Invalid listing" }, { status: 400 });
  if (listing.status === "suspended" && !canModerate(user.role)) {
    return Response.json({ error: "Moderation permission required" }, { status: 403 });
  }
  if (listingBySlug(listing.slug)) return Response.json({ error: "Slug already exists" }, { status: 409 });
  try {
    const created = createListing(listing, user.id);
    return Response.json({ listing: created }, { status: 201 });
  } catch (error) {
    if (error instanceof ProfileValueError) return Response.json({ error: error.message,
      errors: { [error.fieldKey]: error.message } }, { status: error.status });
    if (error instanceof HttpError) return httpErrorResponse(error);
    if (error instanceof Error && error.message.includes("UNIQUE constraint")) {
      return Response.json({ error: "Slug already exists" }, { status: 409 });
    }
    throw error;
  }
}
