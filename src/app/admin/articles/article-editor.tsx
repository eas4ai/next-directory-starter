"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { Article } from "@/lib/articles";
import { ImageUploader } from "@/components/image-uploader";

function ArticleFields({ article, categories, includeSlug, includeStatus = true }: {
  article?: Article; categories: string[]; includeSlug?: boolean; includeStatus?: boolean;
}) {
  const prefix = article ? `edit-${article.slug}` : "new-article";
  return (
    <FieldGroup>
      {includeSlug && <Field><FieldLabel htmlFor={`${prefix}-slug`}>Slug</FieldLabel>
        <Input id={`${prefix}-slug`} name="slug" required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={80} />
      </Field>}
      <Field><FieldLabel htmlFor={`${prefix}-title`}>Title</FieldLabel>
        <Input id={`${prefix}-title`} name="title" defaultValue={article?.title} required maxLength={160} />
      </Field>
      <Field><FieldLabel htmlFor={`${prefix}-summary`}>Summary</FieldLabel>
        <Input id={`${prefix}-summary`} name="summary" defaultValue={article?.summary} required maxLength={320} />
      </Field>
      <Field><FieldLabel htmlFor={`${prefix}-body`}>Body</FieldLabel>
        <textarea id={`${prefix}-body`} name="body" defaultValue={article?.body} required maxLength={50000} className="min-h-64 rounded-md border border-input bg-background px-3 py-2 text-sm" />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field><FieldLabel htmlFor={`${prefix}-category`}>Article category</FieldLabel>
          <select id={`${prefix}-category`} name="category" defaultValue={article?.category ?? ""} className="h-9 rounded-md border border-input bg-background px-3 text-sm">
            <option value="">Uncategorized</option>
            {categories.map((category) => <option key={category} value={category}>{category}</option>)}
          </select>
        </Field>
        <Field><FieldLabel htmlFor={`${prefix}-tags`}>Tags, comma separated</FieldLabel>
          <Input id={`${prefix}-tags`} name="tags" defaultValue={article?.tags.join(", ")} placeholder="Use tags created in taxonomy" />
        </Field>
        {includeStatus && <Field><FieldLabel htmlFor={`${prefix}-status`}>Publication state</FieldLabel>
          <select id={`${prefix}-status`} name="status" defaultValue={article?.status ?? "draft"} className="h-9 rounded-md border border-input bg-background px-3 text-sm">
            <option value="draft">Draft</option>
            <option value="published">Published</option>
          </select>
        </Field>}
      </div>
      <fieldset className="grid gap-4 rounded-md border p-4">
        <legend className="px-1 text-sm font-semibold">Search and social preview</legend>
        <p className="text-xs text-muted-foreground">Overrides remain private until this revision is published.</p>
        <Field><FieldLabel htmlFor={`${prefix}-seo-title`}>Search title</FieldLabel>
          <Input id={`${prefix}-seo-title`} name="seoTitle" defaultValue={article?.seo.title ?? ""} maxLength={160} />
        </Field>
        <Field><FieldLabel htmlFor={`${prefix}-seo-description`}>Search description</FieldLabel>
          <Input id={`${prefix}-seo-description`} name="seoDescription" defaultValue={article?.seo.description ?? ""} maxLength={320} />
        </Field>
        <Field><FieldLabel htmlFor={`${prefix}-seo-image`}>Social image URL or path</FieldLabel>
          <Input id={`${prefix}-seo-image`} name="seoImage" defaultValue={article?.seo.socialImage ?? ""} maxLength={2048} />
        </Field>
        <Field><FieldLabel htmlFor={`${prefix}-seo-indexable`}>Search indexing</FieldLabel>
          <select id={`${prefix}-seo-indexable`} name="seoIndexable"
            defaultValue={article?.seo.indexable === null || article?.seo.indexable === undefined ? "inherit" : article.seo.indexable ? "index" : "noindex"}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm">
            <option value="inherit">Use site default</option><option value="index">Allow indexing</option>
            <option value="noindex">Noindex</option>
          </select>
        </Field>
      </fieldset>
    </FieldGroup>
  );
}

function formArticle(form: HTMLFormElement) {
  const values = Object.fromEntries(new FormData(form));
  return {
    ...values,
    tags: String(values.tags ?? "").split(",").map((tag) => tag.trim()).filter(Boolean),
    seo: {
      title: values.seoTitle, description: values.seoDescription,
      socialImage: values.seoImage,
      indexable: values.seoIndexable === "index" ? true : values.seoIndexable === "noindex" ? false : null,
    },
  };
}

function SavedArticles({ articles, pending, onEdit }: {
  articles: Article[];
  pending: boolean;
  onEdit: (article: Article) => void;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold">Saved articles</h2>
      {articles.map((article) => (
        <div key={article.slug} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
          <div>
            <p className="font-medium">{article.title}</p>
            <p className="text-sm text-muted-foreground">{article.slug} · {article.status}</p>
          </div>
          <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => onEdit(article)}>Edit</Button>
        </div>
      ))}
      {articles.length === 0 && <p className="text-sm text-muted-foreground">No articles yet.</p>}
    </section>
  );
}

export function ArticleEditor({ initialArticles, categories }: { initialArticles: Article[]; categories: string[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<Article | null>(null);
  const [renameSlug, setRenameSlug] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function save(event: FormEvent<HTMLFormElement>, slug?: string) {
    event.preventDefault();
    const form = event.currentTarget;
    setPending(true);
    setMessage("");
    try {
      const response = await fetch(slug ? `/api/admin/articles/${encodeURIComponent(slug)}` : "/api/admin/articles", {
        method: slug ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(slug
          ? { ...formArticle(form), action: "save", version: editing?.version }
          : formArticle(form)),
      });
      if (!response.ok) {
        setMessage((await response.json()).error ?? "Could not save the article.");
        return;
      }
      const data = await response.json() as { article: Article };
      if (slug) setEditing(data.article);
      else form.reset();
      setMessage(slug ? data.article.staged
        ? "Revision saved privately. Publish it when ready."
        : "Draft saved." : "Article created.");
      router.refresh();
    } catch {
      setMessage("Could not connect to the server. Try again.");
    } finally {
      setPending(false);
    }
  }

  async function edit(article: Article) {
    setPending(true);
    setMessage("");
    try {
      const response = await fetch(`/api/admin/articles/${encodeURIComponent(article.slug)}`);
      if (!response.ok) throw new Error();
      const current = (await response.json() as { article: Article }).article;
      setEditing(current);
      setRenameSlug(current.slug);
    } catch {
      setMessage("Could not load the latest article. Try again.");
    } finally {
      setPending(false);
    }
  }

  async function publish() {
    if (!editing) return;
    setPending(true);
    setMessage("");
    try {
      const response = await fetch(`/api/admin/articles/${encodeURIComponent(editing.slug)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "publish", version: editing.version }),
      });
      if (!response.ok) {
        setMessage((await response.json()).error ?? "Could not publish the article.");
        return;
      }
      setEditing((await response.json() as { article: Article }).article);
      setMessage("Saved revision published.");
      router.refresh();
    } catch {
      setMessage("Could not connect to the server. Try again.");
    } finally {
      setPending(false);
    }
  }

  async function rename() {
    if (!editing || renameSlug === editing.slug) return;
    setPending(true);
    setMessage("");
    try {
      const response = await fetch(`/api/admin/articles/${encodeURIComponent(editing.slug)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "rename", newSlug: renameSlug, version: editing.version }),
      });
      if (!response.ok) { setMessage((await response.json()).error ?? "Could not rename article."); return; }
      const article = (await response.json() as { article: Article }).article;
      setEditing(article);
      setRenameSlug(article.slug);
      setMessage("Article slug changed. The old published address now redirects here.");
      router.refresh();
    } catch { setMessage("Could not connect to the server. Try again."); }
    finally { setPending(false); }
  }

  return (
    <div className="mt-8 space-y-10">
      <form onSubmit={(event) => save(event)} className="space-y-4 rounded-lg border p-6">
        <h2 className="text-xl font-semibold">New article</h2>
        <ArticleFields categories={categories} includeSlug />
        <Button type="submit" disabled={pending}>Create article</Button>
      </form>
      {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
      <SavedArticles articles={initialArticles} pending={pending} onEdit={edit} />
      {editing && (
        <form key={editing.slug} onSubmit={(event) => save(event, editing.slug)} className="space-y-4 rounded-lg border p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-semibold">Edit {editing.slug}</h2>
            <Button type="button" variant="ghost" onClick={() => setEditing(null)}>Close</Button>
          </div>
          <ArticleFields article={editing} categories={categories} includeStatus={false} />
          <ImageUploader kind="article" slug={editing.slug} onUploaded={() => { void edit(editing); }} />
          <div className="flex flex-wrap items-end gap-3 rounded-md border p-4">
            <label className="grid min-w-48 flex-1 gap-2 text-sm font-medium">Article slug
              <Input value={renameSlug} onChange={(event) => setRenameSlug(event.target.value)}
                pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={80} />
            </label>
            <Button type="button" variant="outline" disabled={pending || renameSlug === editing.slug}
              onClick={rename}>Change slug</Button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={pending}>Save revision</Button>
            <Button type="button" variant="outline" asChild><Link href={`/admin/articles/${editing.slug}/preview`} target="_blank">Private preview</Link></Button>
            {(editing.status === "draft" || editing.staged) &&
              <Button type="button" variant="secondary" disabled={pending} onClick={publish}>Publish saved revision</Button>}
          </div>
        </form>
      )}
    </div>
  );
}
