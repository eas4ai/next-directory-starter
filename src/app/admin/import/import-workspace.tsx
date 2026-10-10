"use client";

import { useEffect, useState } from "react";

type Key = { id: string; name: string; expiresAt: string; revokedAt: string | null };
type Import = { slug: string; name: string; summary: string; description: string;
  category: string; url: string; sourceUrl: string; sourceExcerpt: string; status: string };
type BrowserTool = { name: string; description: string; inputSchema?: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<unknown> };
type ModelContext = { registerTool: (tool: BrowserTool, options?: { signal: AbortSignal }) => Promise<void> };

async function responseJson(response: Response) {
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? `Request failed (${response.status})`);
  return data;
}

async function post(path: string, body: unknown) {
  return responseJson(await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body) }));
}

export function ImportWorkspace({ initialKeys, initialImports, categories }: {
  initialKeys: Key[]; initialImports: Import[]; categories: string[];
}) {
  const [keys, setKeys] = useState(initialKeys);
  const [imports, setImports] = useState(initialImports);
  const [newSecret, setNewSecret] = useState("");
  const [keyName, setKeyName] = useState("Claude Code");
  const [batch, setBatch] = useState("");
  const [message, setMessage] = useState("");

  async function refresh() {
    const data = await responseJson(await fetch("/api/agent/imports", { cache: "no-store" }));
    setImports(data.items);
  }

  useEffect(() => {
    const context = (document as Document & { modelContext?: ModelContext }).modelContext;
    if (!context) return;
    const controller = new AbortController();
    const access = async () => {
      if (controller.signal.aborted) throw new Error("Import tools are unavailable");
      try {
        return await responseJson(await fetch("/api/agent/access", { cache: "no-store" }));
      } catch (error) {
        controller.abort();
        throw error;
      }
    };
    const checkAccess = () => { void access().catch(() => undefined); };
    const interval = window.setInterval(checkAccess, 5_000);
    document.addEventListener("visibilitychange", checkAccess);
    window.addEventListener("focus", checkAccess);
    const object = (properties: Record<string, unknown>, required: string[] = []) =>
      ({ type: "object", properties, required });
    const string = { type: "string" };
    const definitions: BrowserTool[] = [
      { name: "list_categories", description: "List existing directory categories for observed links.",
        execute: async () => access() },
      { name: "stage_links", description: "Stage up to 20 observed public URLs with source evidence as private drafts.",
        inputSchema: object({ items: { type: "array", minItems: 1, maxItems: 20,
          items: object({ idempotencyKey: string, url: string, sourceUrl: string,
            sourceExcerpt: string, name: string, summary: string, description: string,
            category: string }, ["idempotencyKey", "url", "sourceUrl", "sourceExcerpt",
            "name", "summary", "description", "category"]) } }, ["items"]),
        execute: async ({ items }) => { await access(); const result = await post("/api/agent/imports", { items });
          await refresh(); return result; } },
      { name: "list_imports", description: "List private staged imports and their source evidence.",
        execute: async () => { await access(); return responseJson(await fetch("/api/agent/imports", { cache: "no-store" })); } },
      { name: "publish_import", description: "Publish a reviewed import explicitly.",
        inputSchema: object({ slug: string }, ["slug"]),
        execute: async ({ slug }) => { await access(); const result = await post(
          `/api/agent/imports/${encodeURIComponent(String(slug))}/publish`, {});
          await refresh(); return result; } },
      { name: "attach_screenshot", description: "Attach an agent-browser screenshot to a private import.",
        inputSchema: object({ slug: string, mimeType: string, base64: string },
          ["slug", "mimeType", "base64"]),
        execute: async ({ slug, mimeType, base64 }) => { await access(); return post(
          `/api/agent/imports/${encodeURIComponent(String(slug))}/screenshot`, { mimeType, base64 }); } },
      { name: "preview_card", description: "Get the private social-card preview for a staged import.",
        inputSchema: object({ slug: string }, ["slug"]),
        execute: async ({ slug }) => { await access(); return { previewUrl:
          `/api/agent/imports/${encodeURIComponent(String(slug))}/card` }; } },
    ];
    void Promise.all(definitions.map((definition) =>
      context.registerTool(definition, { signal: controller.signal }).catch(() => undefined)));
    checkAccess();
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", checkAccess);
      window.removeEventListener("focus", checkAccess);
      controller.abort();
    };
  }, [categories]);

  async function createKey() {
    try {
      const created = await post("/api/agent/keys", { name: keyName, expiresInDays: 30 });
      setNewSecret(created.secret);
      setKeys((current) => [{ ...created, revokedAt: null }, ...current]);
      setMessage("Credential created. Copy it now; it will not be shown again.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not create key"); }
  }

  async function revoke(id: string) {
    try {
      const response = await fetch(`/api/agent/keys/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Could not revoke credential");
      setKeys((current) => current.map((key) => key.id === id
        ? { ...key, revokedAt: new Date().toISOString() } : key));
      setMessage("Credential revoked.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not revoke key"); }
  }

  async function stageBatch() {
    try {
      const items: unknown = JSON.parse(batch);
      const result = await post("/api/agent/imports", { items });
      await refresh();
      setMessage(`${result.items.length} link results returned. Review them below.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Invalid batch JSON"); }
  }

  async function publish(slug: string) {
    try {
      await post(`/api/agent/imports/${encodeURIComponent(slug)}/publish`, {});
      await refresh();
      setMessage(`${slug} published.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Publication failed"); }
  }

  return <div className="mt-8 space-y-8">
    <p role="status" className="min-h-6 text-sm text-muted-foreground">{message}</p>
    <section className="rounded-xl border p-5" aria-labelledby="agent-credentials">
      <h2 id="agent-credentials" className="text-xl font-semibold">Claude Code credentials</h2>
      <p className="mt-2 text-sm text-muted-foreground">Create a key for remote MCP. It expires after 30 days and can be revoked here.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <input aria-label="Credential name" value={keyName} onChange={(event) => setKeyName(event.target.value)}
          className="min-w-52 rounded-md border bg-background px-3 py-2" />
        <button type="button" onClick={createKey} className="rounded-md bg-primary px-4 py-2 text-primary-foreground">Create key</button>
      </div>
      {newSecret && <div className="mt-4 rounded-md border bg-muted p-3">
        <p className="text-sm font-medium">Copy this key now</p>
        <code className="mt-2 block break-all text-sm">{newSecret}</code>
        <button type="button" onClick={() => { void navigator.clipboard.writeText(newSecret); }}
          className="mt-2 text-sm underline">Copy key</button>
      </div>}
      <ul className="mt-4 space-y-2 text-sm">
        {keys.map((key) => <li key={key.id} className="flex flex-wrap items-center justify-between gap-3 border-t pt-2">
          <span>{key.name} · expires {new Date(key.expiresAt).toLocaleDateString()}
            {key.revokedAt ? " · revoked" : ""}</span>
          {!key.revokedAt && <button type="button" onClick={() => revoke(key.id)} className="underline">Revoke</button>}
        </li>)}
      </ul>
    </section>
    <section className="rounded-xl border p-5" aria-labelledby="agent-batch">
      <h2 id="agent-batch" className="text-xl font-semibold">Stage observed links</h2>
      <p className="mt-2 text-sm text-muted-foreground">Agent-browser can inspect a single URL, a directory page, or a link list. Paste a JSON array of up to 20 observed links, with category from {categories.join(", ")}.</p>
      <textarea aria-label="Observed links JSON array" value={batch} onChange={(event) => setBatch(event.target.value)}
        rows={5} className="mt-4 w-full rounded-md border bg-background p-3 font-mono text-sm" />
      <button type="button" onClick={stageBatch} className="mt-3 rounded-md bg-primary px-4 py-2 text-primary-foreground">Stage private drafts</button>
    </section>
    <section aria-labelledby="staged-imports">
      <div className="flex items-center justify-between gap-4">
        <h2 id="staged-imports" className="text-xl font-semibold">Imports</h2>
        <button type="button" onClick={() => { void refresh(); }} className="text-sm underline">Refresh</button>
      </div>
      <div className="mt-4 space-y-4">
        {imports.length === 0 && <p className="text-muted-foreground">No imports staged yet.</p>}
        {imports.map((item) => <article key={item.slug} className="min-w-0 rounded-xl border p-5"
          style={{ overflowWrap: "anywhere" }}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h3 className="text-lg font-semibold">{item.name}</h3>
            <span className="text-sm text-muted-foreground">{item.status}</span>
          </div>
          <p className="mt-2">{item.summary}</p>
          <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{item.description}</p>
          <p className="mt-3 text-sm">Category: {item.category}</p>
          <p className="mt-2 text-sm">Source evidence: {item.sourceExcerpt}</p>
          <div className="mt-3 flex flex-wrap gap-4 text-sm underline">
            <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer">Source</a>
            <a href={item.url} target="_blank" rel="noopener noreferrer">Destination</a>
            <a href={`/api/agent/imports/${encodeURIComponent(item.slug)}/card`} target="_blank" rel="noopener noreferrer">Preview social card</a>
            {item.status === "published" && <a href={`/listings/${item.slug}`}>Public listing</a>}
          </div>
          {item.status === "draft" && <button type="button" onClick={() => publish(item.slug)}
            className="mt-4 rounded-md bg-primary px-4 py-2 text-primary-foreground">Publish reviewed import</button>}
        </article>)}
      </div>
    </section>
  </div>;
}
