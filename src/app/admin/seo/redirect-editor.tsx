"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SiteRedirect } from "@/lib/seo-redirects";

type MissingPath = { path: string; hits: number; firstSeenAt: string; lastSeenAt: string };

export function RedirectEditor({ initial, paths }: {
  initial: SiteRedirect[]; paths: MissingPath[];
}) {
  const router = useRouter();
  const [redirects, setRedirects] = useState(initial);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setPending(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/seo/redirects", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(new FormData(form))),
      });
      const data = await response.json();
      if (!response.ok) { setMessage(data.error ?? "Could not save redirect."); return; }
      setRedirects((items) => [data.redirect as SiteRedirect,
        ...items.filter((item) => item.source !== data.redirect.source)].slice(0, 50));
      form.reset();
      setMessage("Permanent redirect saved.");
      router.refresh();
    } catch { setMessage("Could not connect to the server."); }
    finally { setPending(false); }
  }

  async function remove(source: string) {
    setPending(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/seo/redirects", {
        method: "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source }),
      });
      if (!response.ok) { setMessage((await response.json()).error ?? "Could not remove redirect."); return; }
      setRedirects((items) => items.filter((item) => item.source !== source));
      setMessage("Redirect removed.");
      router.refresh();
    } catch { setMessage("Could not connect to the server."); }
    finally { setPending(false); }
  }

  return (
    <div className="mt-10 grid gap-10 lg:grid-cols-2">
      <section className="min-w-0 space-y-4">
        <h2 className="text-xl font-semibold">Permanent redirects</h2>
        <p className="text-sm text-muted-foreground">Use paths on this site. Redirects cannot replace a live page or form a loop.</p>
        <form onSubmit={save} className="grid gap-3 rounded-lg border p-4">
          <label className="grid gap-2 text-sm font-medium">Old path
            <Input name="source" required maxLength={180} placeholder="/old-path" />
          </label>
          <label className="grid gap-2 text-sm font-medium">New path
            <Input name="destination" required maxLength={180} placeholder="/listings/example-tool" />
          </label>
          <Button type="submit" disabled={pending}>Save redirect</Button>
        </form>
        {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
        <ul className="space-y-2 text-sm">
          {redirects.map((item) => <li key={item.source} className="flex min-w-0 items-center justify-between gap-3 rounded-md border p-3">
            <span className="min-w-0 break-all">{item.source} → {item.destination}</span>
            <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => remove(item.source)}>Remove</Button>
          </li>)}
        </ul>
      </section>
      <section className="min-w-0 space-y-4">
        <h2 className="text-xl font-semibold">Missing pages</h2>
        <p className="text-sm text-muted-foreground">Latest 50 paths; query strings and visitor details are never stored.</p>
        <ul className="space-y-2 text-sm">
          {paths.map((item) => <li key={item.path} className="flex justify-between gap-3 rounded-md border p-3">
            <span className="min-w-0 break-all">{item.path}</span><span className="shrink-0 text-muted-foreground">{item.hits} visits</span>
          </li>)}
          {paths.length === 0 && <li className="text-muted-foreground">No missing paths recorded.</li>}
        </ul>
      </section>
    </div>
  );
}
