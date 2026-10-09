import { NextResponse, type NextRequest } from "next/server";
import { publishedListingBySlug } from "@/lib/listings";

export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/listings/")) {
    const slug = request.nextUrl.pathname.slice("/listings/".length);
    if (!publishedListingBySlug(slug)) {
      return new NextResponse("Not Found", { status: 404 });
    }
    return NextResponse.next();
  }

  const { isAdmin } = await import("@/lib/admin");
  if (!(await isAdmin(request.headers))) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  return NextResponse.next();
}

export const config = { matcher: ["/admin/theme/:path*", "/listings/:slug"] };
