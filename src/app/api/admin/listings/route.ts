import { isAdmin } from "@/lib/admin";
import { adminReadResponse } from "@/lib/admin-api";
import { parseListing } from "@/lib/catalog-input";
import { allListings, createListing, listingBySlug } from "@/lib/listings";

export async function GET(request: Request) {
  return adminReadResponse(request, () => ({ listings: allListings() }));
}

export async function POST(request: Request) {
  if (!(await isAdmin(request.headers))) return Response.json({ error: "Forbidden" }, { status: 403 });
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
  if (listingBySlug(listing.slug)) return Response.json({ error: "Slug already exists" }, { status: 409 });
  try {
    createListing(listing);
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE constraint")) {
      return Response.json({ error: "Slug already exists" }, { status: 409 });
    }
    throw error;
  }
  return Response.json({ listing }, { status: 201 });
}
