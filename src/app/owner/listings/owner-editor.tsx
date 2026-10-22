"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Link from "next/link";
import type { Listing } from "@/lib/listings";
import { ImageUploader } from "@/components/image-uploader";
import type { SeoOverrides } from "@/lib/seo-settings";
import { ProfileFieldEditor } from "@/components/profile-field-editor";
import type { DirectoryProfileField, ProfileValueSet } from "@/lib/directory-profile-types";

type OwnerItem = Listing & { hasDraft: boolean; pending: boolean };

function ListingFields({ value, seo, includeSlug, onSlug }: {
  value?: Listing; seo?: SeoOverrides; includeSlug?: boolean; onSlug?: (slug: string) => void;
}) {
  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {includeSlug && <label className="grid gap-2 text-sm font-medium">Slug<Input name="slug" required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={80} onChange={(event) => onSlug?.(event.target.value)} /></label>}
        <label className="grid gap-2 text-sm font-medium">Name<Input name="name" defaultValue={value?.name} required maxLength={120} /></label>
        <label className="grid gap-2 text-sm font-medium">Category<Input name="category" defaultValue={value?.category} required maxLength={80} /></label>
        <label className="grid gap-2 text-sm font-medium">External URL<Input name="url" type="url" defaultValue={value?.url} required maxLength={2048} /></label>
      </div>
      <label className="grid gap-2 text-sm font-medium">Summary<Input name="summary" defaultValue={value?.summary} required maxLength={280} /></label>
      <label className="grid gap-2 text-sm font-medium">Description
        <textarea name="description" defaultValue={value?.description} required maxLength={5000} className="min-h-28 rounded-md border border-input bg-background px-3 py-2 text-sm" />
      </label>
      <fieldset className="grid gap-4 rounded-md border p-4">
        <legend className="px-1 text-sm font-semibold">Search and social preview</legend>
        <p className="text-xs text-muted-foreground">Changes appear publicly after a moderator approves this submission.</p>
        <label className="grid gap-2 text-sm font-medium">Search title
          <Input name="seoTitle" defaultValue={seo?.title ?? ""} maxLength={160} />
        </label>
        <label className="grid gap-2 text-sm font-medium">Search description
          <Input name="seoDescription" defaultValue={seo?.description ?? ""} maxLength={320} />
        </label>
        <label className="grid gap-2 text-sm font-medium">Social image URL or path
          <Input name="seoImage" defaultValue={seo?.socialImage ?? ""} maxLength={2048} />
        </label>
        <label className="grid gap-2 text-sm font-medium">Search indexing
          <select name="seoIndexable" defaultValue={seo?.indexable === null || seo?.indexable === undefined ? "inherit" : seo.indexable ? "index" : "noindex"}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm">
            <option value="inherit">Use site default</option><option value="index">Allow indexing</option>
            <option value="noindex">Noindex</option>
          </select>
        </label>
      </fieldset>
    </div>
  );
}

export function OwnerEditor({ initialListings, profileFields, profileStateRevision }: {
  initialListings: OwnerItem[]; profileFields: DirectoryProfileField[]; profileStateRevision: number;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<Listing | null>(null);
  const [editingSeo, setEditingSeo] = useState<SeoOverrides | undefined>();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [newSlug, setNewSlug] = useState("");
  const [newValues, setNewValues] = useState<ProfileValueSet>(() => Object.fromEntries(
    profileFields.filter((field) => field.default !== undefined && field.writeAuthority === "owner")
      .map((field) => [field.key, field.default])));
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
    setPending(true);
    setMessage("");
    try {
      const response = await fetch("/api/owner/listings", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...Object.fromEntries(new FormData(form)),
          profileValues: newValues, profileStateRevision }),
      });
      if (!response.ok) {
        return responseError(response, "Could not save the draft.");
      }
      form.reset();
      setNewSlug("");
      setMessage("Draft saved. Submit it when it is ready for review.");
      router.refresh();
    } catch {
      setMessage("Could not connect to the server. Try again.");
    } finally {
      setPending(false);
    }
  }

  async function edit(item: OwnerItem) {
    setMessage("");
    try {
      const response = await fetch(`/api/owner/listings/${encodeURIComponent(item.slug)}`);
      if (!response.ok) {
        setMessage("Could not open this listing.");
        return;
      }
      const data = await response.json() as { listing: Listing; proposal: Listing | null; seo: SeoOverrides };
      setEditing(data.proposal ?? data.listing);
      setEditValues((data.proposal ?? data.listing).profileValues ?? {});
      setEditingSeo(data.seo);
    } catch {
      setMessage("Could not connect to the server. Try again.");
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    setPending(true);
    setMessage("");
    try {
      const response = await fetch(`/api/owner/listings/${encodeURIComponent(editing.slug)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...Object.fromEntries(new FormData(event.currentTarget)),
          profileValues: editValues,
          profileStateRevision: editing.profileStateRevision ?? profileStateRevision }),
      });
      if (!response.ok) {
        return responseError(response, "Could not save changes.");
      }
      const data = await response.json() as { listing: Listing };
      setEditing(data.listing);
      setEditValues(data.listing.profileValues ?? editValues);
      setMessage("Changes saved privately. Submit them for review when ready.");
      router.refresh();
    } catch {
      setMessage("Could not connect to the server. Try again.");
    } finally {
      setPending(false);
    }
  }

  async function submit(slug: string) {
    setPending(true);
    setMessage("");
    try {
      const response = await fetch(`/api/owner/listings/${encodeURIComponent(slug)}/submit`, { method: "POST" });
      if (!response.ok) {
        setMessage((await response.json()).error ?? "Could not submit this listing.");
        return;
      }
      setEditing(null);
      setMessage("Submitted for review.");
      router.refresh();
    } catch {
      setMessage("Could not connect to the server. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mt-8 space-y-10">
      <form onSubmit={create} className="space-y-4 rounded-lg border p-6">
        <h2 className="text-xl font-semibold">New private draft</h2>
        <ListingFields includeSlug onSlug={setNewSlug} />
        {profileFields.length > 0 && <fieldset className="grid gap-4 rounded-md border p-4">
          <legend className="px-1 text-sm font-semibold">Directory profile</legend>
          <ProfileFieldEditor fields={profileFields} values={newValues} authority="owner"
            mediaEndpoint={`/api/profile-media/${encodeURIComponent(newSlug)}`}
            errors={fieldErrors} onChange={setNewValues} />
          <p className="text-xs text-muted-foreground">Save the draft before uploading profile media.</p>
        </fieldset>}
        <Button type="submit" disabled={pending}>Save draft</Button>
      </form>
      {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Your listings</h2>
        {initialListings.map((item) => (
          <div key={item.slug} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
            <div>
              <p className="font-medium">{item.name}</p>
              <p className="text-sm text-muted-foreground">{item.slug} · {item.status}{item.pending ? " · awaiting review" : item.hasDraft ? " · private changes saved" : ""}</p>
            </div>
            <div className="flex gap-2">
              {item.status === "published" && <Button asChild size="sm" variant="outline"><Link href={`/owner/listings/${encodeURIComponent(item.slug)}/plans`}>Publishing plans</Link></Button>}
              <Button type="button" size="sm" variant="outline" disabled={pending || item.pending || item.status === "suspended"} onClick={() => edit(item)}>Edit</Button>
              {(item.status === "draft" || item.hasDraft) && !item.pending && item.status !== "suspended" &&
                <Button type="button" size="sm" disabled={pending} onClick={() => submit(item.slug)}>Submit for review</Button>}
            </div>
          </div>
        ))}
        {initialListings.length === 0 && <p className="text-sm text-muted-foreground">You have no listings yet.</p>}
      </section>
      {editing && (
        <form key={editing.slug} onSubmit={save} className="space-y-4 rounded-lg border p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-semibold">Edit {editing.slug}</h2>
            <Button type="button" variant="ghost" onClick={() => setEditing(null)}>Close</Button>
          </div>
          <ListingFields value={editing} seo={editingSeo} />
          {profileFields.length > 0 && <fieldset className="grid gap-4 rounded-md border p-4">
            <legend className="px-1 text-sm font-semibold">Directory profile</legend>
            <ProfileFieldEditor fields={profileFields} values={editValues} authority="owner"
              mediaEndpoint={`/api/profile-media/${encodeURIComponent(editing.slug)}`}
              errors={fieldErrors} onChange={setEditValues} />
          </fieldset>}
          <ImageUploader kind="listing" slug={editing.slug} onUploaded={() => router.refresh()} />
          <Button type="submit" disabled={pending}>Save changes</Button>
        </form>
      )}
    </div>
  );
}
