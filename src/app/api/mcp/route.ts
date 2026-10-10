import { createMcpHandler, hostHeaderValidationResponse,
  McpServer, originValidationResponse } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { agentPrincipal } from "@/lib/agent-keys";
import { directoryCategories } from "@/lib/listings";
import { attachImportScreenshot, importCardPreview,
  listAgentImports, publishAgentImport, stageAgentImports } from "@/lib/agent-imports";

const result = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });
const failed = (error: unknown) => ({ content: [{ type: "text" as const,
  text: error instanceof Error ? error.message : "Import action failed" }], isError: true });

const handler = createMcpHandler(({ authInfo }) => {
  const userId = authInfo?.clientId;
  const server = new McpServer({ name: "directory-import", version: "1.0.0" });
  server.registerTool("list_categories", {
    description: "List existing directory categories before staging observed links.",
  }, async () => result({ categories: directoryCategories() }));
  server.registerTool("stage_links", {
    description: "Stage 1 to 20 URLs observed with agent-browser as private directory drafts. Include source excerpts.",
    inputSchema: z.object({ items: z.array(z.unknown()).min(1).max(20) }),
  }, async ({ items }) => {
    try { return result({ items: stageAgentImports(userId!, items) }); }
    catch (error) { return failed(error); }
  });
  server.registerTool("list_imports", {
    description: "List recent private agent imports with source provenance and publication state.",
  }, async () => result({ items: listAgentImports() }));
  server.registerTool("publish_import", {
    description: "Explicitly publish a reviewed import and record the publishing actor.",
    inputSchema: z.object({ slug: z.string() }),
  }, async ({ slug }) => {
    try { return result(publishAgentImport(userId!, slug)); }
    catch (error) { return failed(error); }
  });
  server.registerTool("attach_screenshot", {
    description: "Attach a validated agent-browser JPEG, PNG, or WebP screenshot to a private import.",
    inputSchema: z.object({ slug: z.string(), mimeType: z.string(), base64: z.string() }),
  }, async ({ slug, mimeType, base64 }) => {
    try { return result(await attachImportScreenshot(userId!, slug, mimeType, base64)); }
    catch (error) { return failed(error); }
  });
  server.registerTool("preview_card", {
    description: "Get the authenticated preview URL for a staged import's social card.",
    inputSchema: z.object({ slug: z.string() }),
  }, async ({ slug }) => {
    try { return result(importCardPreview(slug)); }
    catch (error) { return failed(error); }
  });
  return server;
}, { responseMode: "json" });

async function dispatch(request: Request): Promise<Response> {
  const trusted = new URL(process.env.BETTER_AUTH_URL ?? request.url).hostname;
  const rejected = hostHeaderValidationResponse(request, [trusted]) ??
    originValidationResponse(request, [trusted]);
  if (rejected) return rejected;
  const actor = agentPrincipal(request.headers.get("authorization"));
  if (!actor) return Response.json({ error: "Unauthorized" }, { status: 401 });
  let forwarded = request;
  if (request.method === "POST") {
    const body = await request.text();
    if (Buffer.byteLength(body) > 8 * 1024 * 1024) {
      return Response.json({ error: "Request is too large" }, { status: 413 });
    }
    forwarded = new Request(request.url, { method: request.method, headers: request.headers, body });
  }
  const response = await handler.fetch(forwarded, {
    authInfo: { token: actor.keyId, clientId: actor.userId,
      scopes: ["catalog"], expiresAt: Math.floor(new Date(actor.expiresAt).getTime() / 1000) },
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export const GET = dispatch;
export const POST = dispatch;
export const DELETE = dispatch;
