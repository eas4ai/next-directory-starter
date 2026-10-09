import { adminReadResponse, adminWriteGuard } from "@/lib/admin-api";
import { requestJson } from "@/lib/request-json";
import { createTaxon, deleteTaxon, listTaxa, renameTaxon, taxonomyErrorResponse, type TaxonKind } from "@/lib/taxonomy";

function nameFrom(body: unknown): unknown {
  return body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>).name : undefined;
}

export async function listTaxonomy(kind: TaxonKind, request: Request): Promise<Response> {
  const payload = () => ({ items: listTaxa(kind) });
  return adminReadResponse(request, payload);
}

async function taxonomyWrite(request: Request, action: (name: unknown) => string, status: number): Promise<Response> {
  const denied = await adminWriteGuard(request);
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
  return taxonomyWrite(request, (name) => createTaxon(kind, name), 201);
}

export function renameTaxonomy(kind: TaxonKind, request: Request, original: string): Promise<Response> {
  return taxonomyWrite(request, (name) => renameTaxon(kind, original, name), 200);
}

export async function removeTaxonomy(kind: TaxonKind, request: Request, original: string): Promise<Response> {
  const denied = await adminWriteGuard(request);
  if (denied) return denied;
  try {
    deleteTaxon(kind, original);
    return Response.json({ ok: true });
  } catch (error) {
    return taxonomyErrorResponse(error);
  }
}
