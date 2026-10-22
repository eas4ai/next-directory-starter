"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ProfileFieldEditor } from "@/components/profile-field-editor";
import type { DirectoryProfileField, ProfileValueSet } from "@/lib/directory-profile-types";
import type { Listing } from "@/lib/listings";

function defaults(fields: DirectoryProfileField[]): ProfileValueSet {
  return Object.fromEntries(fields.filter((field) => field.default !== undefined)
    .map((field) => [field.key, field.default]));
}

function CoreFields({ value, includeSlug = false, onSlug }: {
  value?: Listing; includeSlug?: boolean; onSlug?: (slug: string) => void;
}) {
  return <div className="grid gap-4">
    <div className="grid gap-4 sm:grid-cols-2">
      {includeSlug && <label className="grid gap-2 text-sm font-medium">Slug
        <Input name="slug" required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={80}
          onChange={(event) => onSlug?.(event.target.value)} />
      </label>}
      <label className="grid gap-2 text-sm font-medium">Name
        <Input name="name" defaultValue={value?.name} required maxLength={120} />
      </label>
      <label className="grid gap-2 text-sm font-medium">Category
        <Input name="category" defaultValue={value?.category} required maxLength={80} />
      </label>
      <label className="grid gap-2 text-sm font-medium">External URL
        <Input name="url" type="url" defaultValue={value?.url} required maxLength={2048} />
      </label>
    </div>
    <label className="grid gap-2 text-sm font-medium">Summary
      <Input name="summary" defaultValue={value?.summary} required maxLength={280} />
    </label>
    <label className="grid gap-2 text-sm font-medium">Description
      <textarea name="description" defaultValue={value?.description} required maxLength={5000}
        className="min-h-28 rounded-md border border-input bg-background px-3 py-2 text-sm" />
    </label>
    <label className="grid gap-2 text-sm font-medium">Publication state
      <select name="status" defaultValue={value?.status ?? "draft"}
        className="h-9 rounded-md border border-input bg-background px-3 text-sm">
        <option value="draft">Draft</option><option value="published">Published</option>
        {value?.status === "suspended" && <option value="suspended">Suspended</option>}
      </select>
    </label>
  </div>;
}

export function CatalogEditor({ initialListings, canSuspend, profileFields,
  profileStateRevision }: {
  initialListings: Listing[]; canSuspend: boolean; profileFields: DirectoryProfileField[];
  profileStateRevision: number;
}) {
  const [listings, setListings] = useState(initialListings);
  const [message, setMessage] = useState("");
  const [newSlug, setNewSlug] = useState("");
  const [newValues, setNewValues] = useState<ProfileValueSet>(() => defaults(profileFields));
  const [editing, setEditing] = useState<Listing | null>(null);
  const [editValues, setEditValues] = useState<ProfileValueSet>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function responseError(response: Response, fallback: string) {
    const body = await response.json() as { error?: string; errors?: Record<string, string> };
    setFieldErrors(body.errors ?? {});
    setMessage(body.error ?? fallback);
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setFieldErrors({});
    try {
      const response = await fetch("/api/admin/listings", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...Object.fromEntries(new FormData(form)),
          profileValues: newValues, profileStateRevision }),
      });
      if (!response.ok) return responseError(response, "Could not save listing.");
      const { listing } = await response.json() as { listing: Listing };
      setListings((current) => [...current, listing].sort((a, b) => a.name.localeCompare(b.name)));
      form.reset();
      setNewSlug("");
      setNewValues(defaults(profileFields));
      setMessage("Listing saved.");
    } catch {
      setMessage("Could not connect to the server. Try again.");
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    setFieldErrors({});
    try {
      const response = await fetch(`/api/admin/listings/${encodeURIComponent(editing.slug)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...Object.fromEntries(new FormData(event.currentTarget)),
          profileValues: editValues, profileStateRevision: editing.profileStateRevision,
          expectedRevision: editing.revision }),
      });
      if (!response.ok) return responseError(response, "Could not save listing.");
      const updated = (await response.json() as { listing: Listing }).listing;
      setListings((current) => current.map((item) => item.slug === updated.slug ? updated : item));
      setEditing(updated);
      setEditValues(updated.profileValues);
      setMessage("Listing changes saved.");
    } catch {
      setMessage("Could not connect to the server. Try again.");
    }
  }

  async function changeStatus(listing: Listing, status: Listing["status"]) {
    setFieldErrors({});
    try {
      const response = await fetch(`/api/admin/listings/${encodeURIComponent(listing.slug)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, expectedRevision: listing.revision,
          profileStateRevision: listing.profileStateRevision }),
      });
      if (!response.ok) return responseError(response, "Could not change publication state.");
      const updated = (await response.json() as { listing: Listing }).listing;
      setListings((current) => current.map((item) => item.slug === listing.slug ? updated : item));
      setMessage(`${listing.name} is now ${status}.`);
    } catch {
      setMessage("Could not connect to the server. Try again.");
    }
  }

  return <div className="mt-8 space-y-10">
    <form onSubmit={create} className="grid gap-5 rounded-lg border p-6">
      <h2 className="text-xl font-semibold">New listing</h2>
      <CoreFields includeSlug onSlug={setNewSlug} />
      {profileFields.length > 0 && <fieldset className="grid gap-4 rounded-md border p-4">
        <legend className="px-1 text-sm font-semibold">Directory profile</legend>
        <ProfileFieldEditor fields={profileFields} values={newValues} authority="operator"
          mediaEndpoint={`/api/profile-media/${encodeURIComponent(newSlug)}`}
          errors={fieldErrors} onChange={setNewValues} />
        <p className="text-xs text-muted-foreground">Save the listing before uploading profile media.</p>
      </fieldset>}
      <Button type="submit" className="w-fit">Save listing</Button>
    </form>
    <p role="status" className="text-sm text-muted-foreground">{message}</p>
    <section className="space-y-3">
      <h2 className="text-xl font-semibold">Listings</h2>
      {listings.map((listing) => <div key={listing.slug}
        className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
        <div><p className="font-medium">{listing.name}</p>
          <p className="text-sm text-muted-foreground">{listing.category} · {listing.status}</p></div>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => {
            setEditing(listing); setEditValues(listing.profileValues); setFieldErrors({});
          }}>Edit</Button>
          {listing.status === "draft" && <Button type="button" size="sm"
            onClick={() => changeStatus(listing, "published")}>Publish</Button>}
          {listing.status === "published" && <Button type="button" size="sm" variant="outline"
            onClick={() => changeStatus(listing, "draft")}>Unpublish</Button>}
          {canSuspend && listing.status !== "suspended" && <Button type="button" size="sm"
            variant="destructive" onClick={() => changeStatus(listing, "suspended")}>Suspend</Button>}
        </div>
      </div>)}
    </section>
    {editing && <form key={`${editing.slug}-${editing.revision}`} onSubmit={save}
      className="grid gap-5 rounded-lg border p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">Edit {editing.slug}</h2>
        <Button type="button" variant="ghost" onClick={() => setEditing(null)}>Close</Button>
      </div>
      <CoreFields value={editing} />
      {profileFields.length > 0 && <fieldset className="grid gap-4 rounded-md border p-4">
        <legend className="px-1 text-sm font-semibold">Directory profile</legend>
        <ProfileFieldEditor fields={profileFields} values={editValues} authority="operator"
          mediaEndpoint={`/api/profile-media/${encodeURIComponent(editing.slug)}`}
          errors={fieldErrors} onChange={setEditValues} />
      </fieldset>}
      <Button type="submit" className="w-fit">Save changes</Button>
    </form>}
  </div>;
}
