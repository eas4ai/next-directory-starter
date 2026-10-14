import { NextResponse, type NextRequest } from "next/server";
import { publishedListingBySlug } from "@/lib/listings";
import { publishedArticleBySlug } from "@/lib/articles";
import { articleMarkdown, listingMarkdown, markdownHeaders } from "@/lib/markdown-twins";
import { recordNotFound, redirectForPath } from "@/lib/seo-redirects";
import { randomUUID } from "node:crypto";

const llmUserAgent = /(?:^|[\s(;])(?:ChatGPT-User|GPTBot|OAI-SearchBot|ClaudeBot|Claude-User|Claude-SearchBot|PerplexityBot|Perplexity-User)(?:\/|[\s;)]|$)/i;

function wantsMarkdown(request: NextRequest, suffix: boolean): boolean {
  if (suffix) return true;
  const markdownRanges = (request.headers.get("accept") ?? "").split(",")
    .map((range) => range.split(";").map((part) => part.trim()))
    .filter(([type]) => type.toLowerCase() === "text/markdown");
  if (markdownRanges.length) {
    return markdownRanges.some(([, ...parameters]) => {
      const quality = parameters.find((part) => /^q\s*=/i.test(part));
      if (!quality) return true;
      const value = Number(quality.slice(quality.indexOf("=") + 1).trim());
      return Number.isFinite(value) && value > 0 && value <= 1;
    });
  }
  return llmUserAgent.test(request.headers.get("user-agent") ?? "");
}

function markdownResponse(
  request: NextRequest,
  suffix: boolean,
  render: () => string,
): NextResponse | null {
  const supportedMethod = request.method === "GET" ||
    (request.method === "HEAD" && suffix);
  if (!supportedMethod || !wantsMarkdown(request, suffix)) return null;
  return new NextResponse(request.method === "HEAD" ? null : render(), {
    headers: markdownHeaders,
  });
}

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
  const next = (vary = false) => {
    const headers = new Headers(request.headers);
    headers.set("x-directory-path", path);
    headers.set("x-directory-request-id", requestId);
    const response = NextResponse.next({ request: { headers } });
    if (vary) response.headers.set("Vary", "Accept, User-Agent");
    return response;
  };

  if (path.startsWith("/listings/")) {
    const suffix = path.endsWith(".md");
    const slug = path.slice("/listings/".length, suffix ? -3 : undefined);
    const listing = publishedListingBySlug(slug);
    if (!listing) {
      recordNotFound(path, requestId);
      return new NextResponse("Not Found", { status: 404 });
    }
    const markdown = markdownResponse(request, suffix, () => listingMarkdown(listing));
    if (markdown) return markdown;
    return next(true);
  }

  if (path.startsWith("/articles/")) {
    const suffix = path.endsWith(".md");
    const slug = path.slice("/articles/".length, suffix ? -3 : undefined);
    const article = publishedArticleBySlug(slug);
    if (!article) {
      recordNotFound(path, requestId);
      return new NextResponse("Not Found", { status: 404 });
    }
    const markdown = markdownResponse(request, suffix, () => articleMarkdown(article));
    if (markdown) return markdown;
    return next(true);
  }

  if (path.startsWith("/owner/listings") || path.startsWith("/owner/billing")) {
    const { sessionUser } = await import("@/lib/admin");
    if (!(await sessionUser(request.headers))) {
      return NextResponse.redirect(new URL("/owner/sign-in", request.url));
    }
    return next();
  }

  if (path.startsWith("/admin/overview")) {
    const { canOpenOverview, sessionUser } = await import("@/lib/admin");
    if (!canOpenOverview((await sessionUser(request.headers))?.role)) {
      return new NextResponse("Forbidden", { status: 403 });
    }
    return next();
  }

  if (path.startsWith("/admin/articles") || path.startsWith("/admin/taxonomy") ||
      path.startsWith("/admin/catalog") || path.startsWith("/admin/import") || path.startsWith("/admin/plans") ||
      path.startsWith("/admin/billing") || path.startsWith("/admin/review")) {
    const { canEditArticles, canManageBilling, canManageCatalog,
      canManageTaxonomy, canModerate, sessionUser } = await import("@/lib/admin");
    const role = (await sessionUser(request.headers))?.role;
    const allowed = path.startsWith("/admin/articles") ? canEditArticles(role) :
      path.startsWith("/admin/taxonomy") ? canManageTaxonomy(role) :
        path.startsWith("/admin/catalog") || path.startsWith("/admin/import") ? canManageCatalog(role) :
          path.startsWith("/admin/plans") || path.startsWith("/admin/billing")
            ? canManageBilling(role) : canModerate(role);
    if (!allowed) {
      return new NextResponse("Forbidden", { status: 403 });
    }
    return next();
  }

  if (path.startsWith("/admin/") && !path.startsWith("/admin/sign-in")) {
    const { isAdmin } = await import("@/lib/admin");
    if (!(await isAdmin(request.headers))) return new NextResponse("Forbidden", { status: 403 });
  }
  return next();
}

export const config = { matcher: ["/((?!_next/|.*\\..*).*)", "/listings/:slug.md", "/articles/:slug.md"] };
