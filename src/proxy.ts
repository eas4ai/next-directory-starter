import { NextResponse, type NextRequest } from "next/server";
import { publishedListingBySlug } from "@/lib/listings";
import { publishedArticleBySlug } from "@/lib/articles";
import { recordNotFound, redirectForPath } from "@/lib/seo-redirects";
import { randomUUID } from "node:crypto";

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const requestId = randomUUID();
  if (request.method === "GET" || request.method === "HEAD") {
    const destination = redirectForPath(path);
    if (destination) {
      const origin = process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || process.env.BETTER_AUTH_URL;
      if (!origin) throw new Error("Set SITE_URL before serving permanent redirects.");
      const base = new URL(origin);
      if (!["http:", "https:"].includes(base.protocol) || base.username || base.password) {
        throw new Error("SITE_URL must be a public HTTP(S) origin.");
      }
      return NextResponse.redirect(new URL(destination, base.origin), 301);
    }
  }
  const next = () => {
    const headers = new Headers(request.headers);
    headers.set("x-directory-path", path);
    headers.set("x-directory-request-id", requestId);
    return NextResponse.next({ request: { headers } });
  };

  if (path.startsWith("/listings/")) {
    const slug = path.slice("/listings/".length);
    if (!publishedListingBySlug(slug)) {
      recordNotFound(path, requestId);
      return new NextResponse("Not Found", { status: 404 });
    }
    return next();
  }

  if (path.startsWith("/articles/")) {
    const slug = path.slice("/articles/".length);
    if (!publishedArticleBySlug(slug)) {
      recordNotFound(path, requestId);
      return new NextResponse("Not Found", { status: 404 });
    }
    return next();
  }

  if (path.startsWith("/owner/listings") || path.startsWith("/owner/billing")) {
    const { sessionUser } = await import("@/lib/admin");
    if (!(await sessionUser(request.headers))) {
      return NextResponse.redirect(new URL("/owner/sign-in", request.url));
    }
    return next();
  }

  if (path.startsWith("/admin/articles") || path.startsWith("/admin/taxonomy")) {
    const { canEditArticles, sessionUser } = await import("@/lib/admin");
    if (!canEditArticles((await sessionUser(request.headers))?.role)) {
      return new NextResponse("Forbidden", { status: 403 });
    }
    return next();
  }

  if (path.startsWith("/admin/") && !path.startsWith("/admin/sign-in")) {
    const { isAdmin, canModerate, sessionUser } = await import("@/lib/admin");
    const allowed = path.startsWith("/admin/review")
      ? canModerate((await sessionUser(request.headers))?.role)
      : await isAdmin(request.headers);
    if (!allowed) return new NextResponse("Forbidden", { status: 403 });
  }
  return next();
}

export const config = { matcher: ["/((?!_next/|.*\\..*).*)"] };
