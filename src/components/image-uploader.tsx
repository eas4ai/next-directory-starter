"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function ImageUploader({ kind, slug, onUploaded }: {
  kind: "listing" | "article"; slug: string; onUploaded?: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [alt, setAlt] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function upload() {
    if (!file || !alt.trim()) {
      setMessage("Choose an image and describe it first.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setMessage("Choose an image no larger than 5 MiB.");
      return;
    }
    setPending(true);
    setMessage("");
    const endpoint = kind === "listing"
      ? `/api/owner/listings/${encodeURIComponent(slug)}/media`
      : `/api/admin/articles/${encodeURIComponent(slug)}/media`;
    try {
      const response = await fetch(endpoint, { method: "POST", body: file,
        headers: { "Content-Type": file.type, "X-Image-Alt": encodeURIComponent(alt.trim()) } });
      if (!response.ok) {
        setMessage((await response.json()).error ?? "Could not upload the image.");
        return;
      }
      setFile(null);
      setAlt("");
      setMessage("Image saved privately. It will be public after approval or publication.");
      onUploaded?.();
    } catch {
      setMessage("Could not connect to the server. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-3 rounded-md border p-4">
      <p className="text-sm font-medium">Image</p>
      <Input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
      <Input value={alt} onChange={(event) => setAlt(event.target.value)} maxLength={160} placeholder="Describe the image for visitors" aria-label="Image alt text" />
      <Button type="button" variant="outline" disabled={pending} onClick={upload}>Upload image privately</Button>
      {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
    </div>
  );
}
