import { canManageCatalog, sameOrigin, sessionUser } from "@/lib/admin";
import { attachImportScreenshot } from "@/lib/agent-imports";
import { database } from "@/lib/database";
import { requestJson, requestJsonErrorResponse } from "@/lib/request-json";

export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  const user = await sessionUser(request.headers);
  if (!user || !canManageCatalog(user.role)) return Response.json({ error: "Forbidden" }, { status: 403 });
  const row = database.prepare(`SELECT screenshot_bytes, screenshot_mime FROM agent_imports
    WHERE slug = ?`).get((await context.params).slug) as {
      screenshot_bytes: Buffer | null; screenshot_mime: string | null;
    } | undefined;
  if (!row?.screenshot_bytes || !row.screenshot_mime) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(row.screenshot_bytes), {
    headers: { "Content-Type": row.screenshot_mime, "Cache-Control": "private, no-store" },
  });
}

export async function POST(request: Request, context: { params: Promise<{ slug: string }> }) {
  const user = await sessionUser(request.headers);
  if (!user || !canManageCatalog(user.role)) return Response.json({ error: "Forbidden" }, { status: 403 });
  if (!sameOrigin(request)) return Response.json({ error: "Invalid origin" }, { status: 403 });
  let mimeType: unknown;
  let base64: unknown;
  try {
    const input = await requestJson(request, 7_100_000);
    if (!input || typeof input !== "object") throw new Error("Invalid screenshot");
    ({ mimeType, base64 } = input as Record<string, unknown>);
    if (typeof mimeType !== "string" || typeof base64 !== "string") throw new Error("Invalid screenshot");
  } catch (error) {
    const response = requestJsonErrorResponse(error);
    return response.status === 413
      ? response
      : Response.json({ error: "Invalid screenshot" }, { status: 400 });
  }
  try {
    return Response.json(await attachImportScreenshot(user.id, (await context.params).slug,
      mimeType as string, base64 as string));
  } catch {
    return Response.json({ error: "Invalid screenshot" }, { status: 400 });
  }
}
