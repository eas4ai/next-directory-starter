import { canManageTaxonomy, sameOrigin, sessionUser } from "@/lib/admin";
import { requestJson } from "@/lib/request-json";
import { createTaxon, deleteTaxon, listTaxa, renameTaxon, taxonomyErrorResponse, type TaxonKind } from "@/lib/taxonomy";

function nameFrom(body: unknown): unknown {
  return body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>).name : undefined;
}

export async function listTaxonomy(kind: TaxonKind, request: Request): Promise<Response> {
  const payload = () => ({ items: listTaxa(kind) });
  const user = await sessionUser(request.headers);
  return canManageTaxonomy(user?.role)
    ? Response.json(payload()) : Response.json({ error: "Forbidden" }, { status: 403 });
}

async function taxonomyWriteGuard(request: Request) {
  const user = await sessionUser(request.headers);
  if (!user || !canManageTaxonomy(user.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!sameOrigin(request)) return Response.json({ error: "Invalid origin" }, { status: 403 });
  return user;
}

async function taxonomyWrite(kind: TaxonKind, request: Request,
  action: (name: unknown, actorId: string) => string, status: number): Promise<Response> {
  const actor = await taxonomyWriteGuard(request);
  if (actor instanceof Response) return actor;
  let body: unknown;
  try { body = await requestJson(request); }
  catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  try {
    return Response.json({ name: action(nameFrom(body), actor.id) }, { status });
  } catch (error) {
    return taxonomyErrorResponse(error);
  }
}

export function createTaxonomy(kind: TaxonKind, request: Request): Promise<Response> {
  return taxonomyWrite(kind, request, (name, actorId) => createTaxon(kind, name, actorId), 201);
}

export function renameTaxonomy(kind: TaxonKind, request: Request, original: string): Promise<Response> {
  return taxonomyWrite(kind, request,
    (name, actorId) => renameTaxon(kind, original, name, actorId), 200);
}

export async function removeTaxonomy(kind: TaxonKind, request: Request, original: string): Promise<Response> {
  const actor = await taxonomyWriteGuard(request);
  if (actor instanceof Response) return actor;
  try {
    deleteTaxon(kind, original, actor.id);
    return Response.json({ ok: true });
  } catch (error) {
    return taxonomyErrorResponse(error);
  }
}
