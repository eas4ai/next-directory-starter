import { NextResponse, type NextRequest } from "next/server";
import { publishedListingBySlug } from "@/lib/listings";
import { publishedArticleBySlug } from "@/lib/articles";

export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/listings/")) {
    const slug = request.nextUrl.pathname.slice("/listings/".length);
    if (!publishedListingBySlug(slug)) {
      return new NextResponse("Not Found", { status: 404 });
    }
    return NextResponse.next();
  }

  if (request.nextUrl.pathname.startsWith("/articles/")) {
    const slug = request.nextUrl.pathname.slice("/articles/".length);
    if (!publishedArticleBySlug(slug)) {
      return new NextResponse("Not Found", { status: 404 });
    }
    return NextResponse.next();
  }

  if (request.nextUrl.pathname.startsWith("/owner/listings")) {
    const { sessionUser } = await import("@/lib/admin");
    if (!(await sessionUser(request.headers))) {
      return NextResponse.redirect(new URL("/owner/sign-in", request.url));
    }
    return NextResponse.next();
  }

  if (request.nextUrl.pathname.startsWith("/admin/articles")) {
    const { canEditArticles, sessionUser } = await import("@/lib/admin");
    if (!canEditArticles((await sessionUser(request.headers))?.role)) {
      return new NextResponse("Forbidden", { status: 403 });
    }
    return NextResponse.next();
  }

  const { isAdmin, canModerate, sessionUser } = await import("@/lib/admin");
  const allowed = request.nextUrl.pathname.startsWith("/admin/review")
    ? canModerate((await sessionUser(request.headers))?.role)
    : await isAdmin(request.headers);
  if (!allowed) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  return NextResponse.next();
}

export const config = { matcher: ["/admin/theme/:path*", "/admin/catalog/:path*", "/admin/review/:path*", "/admin/articles/:path*", "/admin/taxonomy/:path*", "/admin/plans/:path*", "/admin/accounts/:path*", "/admin/audit/:path*", "/owner/listings/:path*", "/listings/:slug", "/articles/:slug"] };
