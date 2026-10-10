import { adminReadResponse, adminWriteGuard } from "@/lib/admin-api";
import { canEditArticles, sameOrigin, sessionUser } from "@/lib/admin";
import { requestJson } from "@/lib/request-json";
import { createTaxon, deleteTaxon, listTaxa, renameTaxon, taxonomyErrorResponse, type TaxonKind } from "@/lib/taxonomy";

function nameFrom(body: unknown): unknown {
  return body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>).name : undefined;
}

export async function listTaxonomy(kind: TaxonKind, request: Request): Promise<Response> {
  const payload = () => ({ items: listTaxa(kind) });
  if (kind !== "article-category") return adminReadResponse(request, payload);
  const user = await sessionUser(request.headers);
  return canEditArticles(user?.role)
    ? Response.json(payload()) : Response.json({ error: "Forbidden" }, { status: 403 });
}

async function taxonomyWriteGuard(kind: TaxonKind, request: Request): Promise<Response | null> {
  if (kind !== "article-category") return adminWriteGuard(request);
  const user = await sessionUser(request.headers);
  if (!canEditArticles(user?.role)) return Response.json({ error: "Forbidden" }, { status: 403 });
  if (!sameOrigin(request)) return Response.json({ error: "Invalid origin" }, { status: 403 });
  return null;
}

async function taxonomyWrite(kind: TaxonKind, request: Request,
  action: (name: unknown) => string, status: number): Promise<Response> {
  const denied = await taxonomyWriteGuard(kind, request);
  if (denied) return denied;
  let body: unknown;
  try { body = await requestJson(request); }
  catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  try {
    return Response.json({ name: action(nameFrom(body)) }, { status });
  } catch (error) {
    return taxonomyErrorResponse(error);
  }
}

export function createTaxonomy(kind: TaxonKind, request: Request): Promise<Response> {
  return taxonomyWrite(kind, request, (name) => createTaxon(kind, name), 201);
}

export function renameTaxonomy(kind: TaxonKind, request: Request, original: string): Promise<Response> {
  return taxonomyWrite(kind, request, (name) => renameTaxon(kind, original, name), 200);
}

export async function removeTaxonomy(kind: TaxonKind, request: Request, original: string): Promise<Response> {
  const denied = await taxonomyWriteGuard(kind, request);
  if (denied) return denied;
  try {
    deleteTaxon(kind, original);
    return Response.json({ ok: true });
  } catch (error) {
    return taxonomyErrorResponse(error);
  }
}
