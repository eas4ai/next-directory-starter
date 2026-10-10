"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Listing } from "@/lib/listings";

export function CatalogEditor({ initialListings, canSuspend }: { initialListings: Listing[]; canSuspend: boolean }) {
  const [listings, setListings] = useState(initialListings);
  const [message, setMessage] = useState("");

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    try {
      const response = await fetch("/api/admin/listings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!response.ok) {
        setMessage((await response.json()).error ?? "Could not save listing.");
        return;
      }
      const { listing } = await response.json() as { listing: Listing };
      setListings((current) => [...current, listing].sort((a, b) => a.name.localeCompare(b.name)));
      form.reset();
      setMessage("Listing saved.");
    } catch {
      setMessage("Could not connect to the server. Try again.");
    }
  }

  async function changeStatus(listing: Listing, status: Listing["status"]) {
    try {
      const response = await fetch(`/api/admin/listings/${encodeURIComponent(listing.slug)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) {
        setMessage((await response.json()).error ?? "Could not change publication state.");
        return;
      }
      setListings((current) => current.map((item) => item.slug === listing.slug ? { ...item, status } : item));
      setMessage(`${listing.name} is now ${status}.`);
    } catch {
      setMessage("Could not connect to the server. Try again.");
    }
  }

  return (
    <div className="mt-8 space-y-10">
      <form onSubmit={create} className="grid gap-4 rounded-lg border p-6">
        <h2 className="text-xl font-semibold">New listing</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-2 text-sm font-medium">Slug<Input name="slug" required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={80} /></label>
          <label className="grid gap-2 text-sm font-medium">Name<Input name="name" required maxLength={120} /></label>
          <label className="grid gap-2 text-sm font-medium">Category<Input name="category" required maxLength={80} /></label>
          <label className="grid gap-2 text-sm font-medium">External URL<Input name="url" type="url" required maxLength={2048} /></label>
        </div>
        <label className="grid gap-2 text-sm font-medium">Summary<Input name="summary" required maxLength={280} /></label>
        <label className="grid gap-2 text-sm font-medium">Description<textarea name="description" required maxLength={5000} className="min-h-28 rounded-md border border-input bg-background px-3 py-2 text-sm" /></label>
        <label className="grid gap-2 text-sm font-medium">Publication state
          <select name="status" defaultValue="draft" className="h-9 rounded-md border border-input bg-background px-3 text-sm">
            <option value="draft">Draft</option><option value="published">Published</option>
          </select>
        </label>
        <Button type="submit" className="w-fit">Save listing</Button>
      </form>
      <p role="status" className="text-sm text-muted-foreground">{message}</p>
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Listings</h2>
        {listings.map((listing) => (
          <div key={listing.slug} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
            <div><p className="font-medium">{listing.name}</p><p className="text-sm text-muted-foreground">{listing.category} · {listing.status}</p></div>
            <div className="flex gap-2">
              {listing.status === "draft" && <Button type="button" size="sm" onClick={() => changeStatus(listing, "published")}>Publish</Button>}
              {listing.status === "published" && <Button type="button" size="sm" variant="outline" onClick={() => changeStatus(listing, "draft")}>Unpublish</Button>}
              {canSuspend && listing.status !== "suspended" && <Button type="button" size="sm" variant="destructive" onClick={() => changeStatus(listing, "suspended")}>Suspend</Button>}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
