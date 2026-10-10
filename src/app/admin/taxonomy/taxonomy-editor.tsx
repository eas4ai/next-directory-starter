"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Taxon, TaxonKind } from "@/lib/taxonomy";

function TaxonRow({ item, pending, onRename, onDelete }: {
  item: Taxon;
  pending: boolean;
  onRename: (oldName: string, nextName: string) => void;
  onDelete: (name: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-md border p-3">
      <form onSubmit={(event) => {
        event.preventDefault();
        onRename(item.name, String(new FormData(event.currentTarget).get("name") ?? ""));
      }} className="flex min-w-48 flex-1 flex-wrap items-end gap-2">
        <label className="grid min-w-40 flex-1 gap-1 text-sm font-medium">Name
          <Input name="name" defaultValue={item.name} required maxLength={80} />
        </label>
        <Button type="submit" variant="outline" size="sm" disabled={pending}>Rename</Button>
      </form>
      <span className="pb-1 text-xs text-muted-foreground">{item.usageCount} in use</span>
      <Button type="button" variant="destructive" size="sm" disabled={pending || item.usageCount > 0}
        onClick={() => onDelete(item.name)}>Delete</Button>
    </div>
  );
}

function TaxonomySection({ kind, title, items }: { kind: TaxonKind; title: string; items: Taxon[] }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const endpoint = kind === "category" ? "/api/admin/categories" :
    kind === "article-category" ? "/api/admin/article-categories" : "/api/admin/tags";

  async function change(method: "POST" | "PATCH" | "DELETE", name: string, next?: string) {
    setPending(true);
    setMessage("");
    try {
      const response = await fetch(method === "POST" ? endpoint : `${endpoint}/${encodeURIComponent(name)}`, {
        method,
        headers: method === "DELETE" ? undefined : { "Content-Type": "application/json" },
        body: method === "DELETE" ? undefined : JSON.stringify({ name: next ?? name }),
      });
      if (!response.ok) {
        setMessage((await response.json()).error ?? "Could not save the name.");
        return false;
      }
      setMessage(method === "DELETE" ? "Name removed." : "Name saved.");
      router.refresh();
      return true;
    } catch {
      setMessage("Could not connect to the server. Try again.");
      return false;
    } finally {
      setPending(false);
    }
  }

  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const name = String(new FormData(form).get("name") ?? "");
    void change("POST", name).then((saved) => { if (saved) form.reset(); });
  }

  return (
    <section className="rounded-lg border p-6">
      <h2 className="text-xl font-semibold">{title}</h2>
      <form onSubmit={add} className="mt-5 flex flex-wrap items-end gap-3">
        <label className="grid min-w-48 flex-1 gap-2 text-sm font-medium">New name
          <Input name="name" required maxLength={80} />
        </label>
        <Button type="submit" disabled={pending}>Add {kind === "article-category" ? "article category" : kind}</Button>
      </form>
      <div className="mt-6 space-y-3">
        {items.map((item) => (
          <TaxonRow key={item.name} item={item} pending={pending}
            onRename={(oldName, nextName) => { void change("PATCH", oldName, nextName); }}
            onDelete={(name) => { void change("DELETE", name); }} />
        ))}
        {items.length === 0 && <p className="text-sm text-muted-foreground">No names yet.</p>}
      </div>
      {message && <p role="status" className="mt-4 text-sm text-muted-foreground">{message}</p>}
    </section>
  );
}

export function TaxonomyEditor({ categories, articleCategories, tags, operator }: {
  categories: Taxon[]; articleCategories: Taxon[]; tags: Taxon[]; operator: boolean;
}) {
  return (
    <div className="mt-8 grid gap-6 lg:grid-cols-2">
      {operator && <TaxonomySection kind="category" title="Listing categories" items={categories} />}
      <TaxonomySection kind="article-category" title="Article categories" items={articleCategories} />
      {operator && <TaxonomySection kind="tag" title="Tags" items={tags} />}
    </div>
  );
}
