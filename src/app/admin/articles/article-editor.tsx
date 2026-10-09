"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { Article } from "@/lib/articles";

function ArticleFields({ article, includeSlug }: { article?: Article; includeSlug?: boolean }) {
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
        <Field><FieldLabel htmlFor={`${prefix}-tags`}>Tags, comma separated</FieldLabel>
          <Input id={`${prefix}-tags`} name="tags" defaultValue={article?.tags.join(", ")} placeholder="Use tags created in taxonomy" />
        </Field>
        <Field><FieldLabel htmlFor={`${prefix}-status`}>Publication state</FieldLabel>
          <select id={`${prefix}-status`} name="status" defaultValue={article?.status ?? "draft"} className="h-9 rounded-md border border-input bg-background px-3 text-sm">
            <option value="draft">Draft</option>
            <option value="published">Published</option>
          </select>
        </Field>
      </div>
    </FieldGroup>
  );
}

function formArticle(form: HTMLFormElement) {
  const values = Object.fromEntries(new FormData(form));
  return {
    ...values,
    tags: String(values.tags ?? "").split(",").map((tag) => tag.trim()).filter(Boolean),
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

export function ArticleEditor({ initialArticles }: { initialArticles: Article[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<Article | null>(null);
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
        body: JSON.stringify(formArticle(form)),
      });
      if (!response.ok) {
        setMessage((await response.json()).error ?? "Could not save the article.");
        return;
      }
      const data = await response.json() as { article: Article };
      if (slug) setEditing(data.article);
      else form.reset();
      setMessage(slug ? "Article updated." : "Article created.");
      router.refresh();
    } catch {
      setMessage("Could not connect to the server. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mt-8 space-y-10">
      <form onSubmit={(event) => save(event)} className="space-y-4 rounded-lg border p-6">
        <h2 className="text-xl font-semibold">New article</h2>
        <ArticleFields includeSlug />
        <Button type="submit" disabled={pending}>Create article</Button>
      </form>
      {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
      <SavedArticles articles={initialArticles} pending={pending} onEdit={(article) => { setEditing(article); setMessage(""); }} />
      {editing && (
        <form key={editing.slug} onSubmit={(event) => save(event, editing.slug)} className="space-y-4 rounded-lg border p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-semibold">Edit {editing.slug}</h2>
            <Button type="button" variant="ghost" onClick={() => setEditing(null)}>Close</Button>
          </div>
          <ArticleFields article={editing} />
          <Button type="submit" disabled={pending}>Save changes</Button>
        </form>
      )}
    </div>
  );
}
