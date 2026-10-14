import { canAdmin, canManageCatalog, sessionUser } from "@/lib/admin";
import { parseListing } from "@/lib/catalog-input";
import { listingBySlug, updateListing } from "@/lib/listings";
import { HttpError, httpErrorResponse } from "@/lib/http-error";
import { requestJson, requestJsonErrorResponse } from "@/lib/request-json";
import { ProfileValueError } from "@/lib/profile-values";

export async function PATCH(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const user = await sessionUser(request.headers);
  if (!user || !canManageCatalog(user.role)) return Response.json({ error: "Forbidden" }, { status: 403 });
  const siteOrigin = new URL(process.env.BETTER_AUTH_URL ?? request.url).origin;
  if (request.headers.get("origin") !== siteOrigin) {
    return Response.json({ error: "Invalid origin" }, { status: 403 });
  }
  const { slug } = await params;
  let changes: unknown;
  try {
    changes = await requestJson(request, 256 * 1024);
  } catch (error) {
    return requestJsonErrorResponse(error);
  }
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) {
    return Response.json({ error: "Invalid listing" }, { status: 400 });
  }
  const existing = listingBySlug(slug, !canAdmin(user.role));
  if (!existing) return Response.json({ error: "Listing not found" }, { status: 404 });
  const listing = parseListing({ ...existing, ...changes, slug: existing.slug });
  if (!listing) return Response.json({ error: "Invalid listing" }, { status: 400 });
  try {
    const updated = updateListing(listing, user.id,
      (changes as Record<string, unknown>).expectedRevision as number);
    return Response.json({ listing: updated });
  } catch (error) {
    if (error instanceof ProfileValueError) return Response.json({ error: error.message,
      errors: { [error.fieldKey]: error.message } }, { status: error.status });
    if (error instanceof HttpError) return httpErrorResponse(error);
    throw error;
  }
}
