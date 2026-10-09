import { randomUUID } from "node:crypto";
import { database } from "@/lib/database";
import { migrateCatalog } from "@/lib/catalog-migrations";
import { parseListing } from "@/lib/catalog-input";
import type { Listing } from "@/lib/listings";

migrateCatalog();

export class ModerationError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function moderationErrorResponse(error: unknown): Response {
  if (error instanceof ModerationError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  throw error;
}

type StoredListing = Listing & { owner_user_id: string | null };
type StoredSubmission = {
  id: string;
  slug: string;
  owner_user_id: string;
  payload: string;
  status: "pending" | "approved" | "rejected";
  reason: string | null;
  submitted_at: string;
  decided_at: string | null;
  decided_by: string | null;
  owner_email?: string;
  decided_by_email?: string | null;
  listing_status?: Listing["status"];
};

export type ReviewSubmission = {
  id: string;
  slug: string;
  ownerUserId: string;
  ownerEmail: string;
  proposed: Listing;
  status: StoredSubmission["status"];
  reason: string | null;
  submittedAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  decidedByEmail: string | null;
  listingStatus: Listing["status"] | null;
};

function reviewSubmission(row: StoredSubmission): ReviewSubmission {
  return {
    id: row.id,
    slug: row.slug,
    ownerUserId: row.owner_user_id,
    ownerEmail: row.owner_email ?? "",
    proposed: JSON.parse(row.payload) as Listing,
    status: row.status,
    reason: row.reason,
    submittedAt: row.submitted_at,
    decidedAt: row.decided_at,
    decidedBy: row.decided_by,
    decidedByEmail: row.decided_by_email ?? null,
    listingStatus: row.listing_status ?? null,
  };
}

function ownedListing(userId: string, slug: string): StoredListing {
  const row = database.prepare("SELECT * FROM listings WHERE slug = ? AND ? IS NOT NULL")
    .get(slug, userId) as StoredListing | undefined;
  if (!row) throw new ModerationError(404, "Listing not found");
  return row;
}

function pendingSubmission(slug: string): boolean {
  return Boolean(database.prepare("SELECT 1 FROM submissions WHERE slug = ? AND status = 'pending'").get(slug));
}

export function ownerListings(userId: string): (Listing & { hasDraft: boolean; pending: boolean })[] {
  const rows = database.prepare(`SELECT l.*,
    EXISTS(SELECT 1 FROM owner_drafts d WHERE d.slug = l.slug) AS has_draft,
    EXISTS(SELECT 1 FROM submissions s WHERE s.slug = l.slug AND s.status = 'pending') AS pending
    FROM listings l WHERE l.owner_user_id = ? ORDER BY l.name COLLATE NOCASE, l.slug`)
    .all(userId) as (StoredListing & { has_draft: number; pending: number })[];
  return rows.map(({ has_draft, pending, ...listing }) => ({
    ...listing, hasDraft: Boolean(has_draft), pending: Boolean(pending),
  }));
}

export function ownerListing(userId: string, slug: string): { listing: Listing; proposal: Listing | null; pending: boolean } {
  const listing = ownedListing(userId, slug);
  const draft = database.prepare("SELECT payload FROM owner_drafts WHERE slug = ?").get(slug) as { payload: string } | undefined;
  return { listing, proposal: draft ? JSON.parse(draft.payload) as Listing : null, pending: pendingSubmission(slug) };
}

export function createOwnerListing(userId: string, input: unknown): Listing {
  const listing = parseListing({ ...(input && typeof input === "object" && !Array.isArray(input) ? input : {}), status: "draft" });
  if (!listing) throw new ModerationError(400, "Invalid listing");
  try {
    database.transaction(() => {
      database.prepare("INSERT OR IGNORE INTO categories (name) VALUES (?)").run(listing.category);
      database.prepare(`INSERT INTO listings
        (slug, name, summary, description, category, url, status, owner_user_id)
        VALUES (?, ?, ?, ?, ?, ?, 'draft', ?)`).run(
        listing.slug, listing.name, listing.summary, listing.description,
        listing.category, listing.url, userId,
      );
    }).immediate();
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE constraint")) {
      throw new ModerationError(409, "Slug already exists");
    }
    throw error;
  }
  return listing;
}

export function updateOwnerListing(userId: string, slug: string, changes: unknown): Listing {
  return database.transaction(() => {
    const current = ownedListing(userId, slug);
    if (pendingSubmission(slug)) throw new ModerationError(409, "Wait for the current review");
    if (!changes || typeof changes !== "object" || Array.isArray(changes)) {
      throw new ModerationError(400, "Invalid listing changes");
    }
    const draft = database.prepare("SELECT payload FROM owner_drafts WHERE slug = ?").get(slug) as { payload: string } | undefined;
    const base = draft ? JSON.parse(draft.payload) as Listing : current;
    const listing = parseListing({ ...base, ...changes, slug, status: current.status });
    if (!listing) throw new ModerationError(400, "Invalid listing changes");
    if (current.status === "draft") {
      database.prepare("INSERT OR IGNORE INTO categories (name) VALUES (?)").run(listing.category);
      database.prepare(`UPDATE listings SET name = ?, summary = ?, description = ?, category = ?, url = ?
        WHERE slug = ? AND owner_user_id = ?`).run(listing.name, listing.summary,
        listing.description, listing.category, listing.url, slug, userId);
    } else {
      database.prepare("UPDATE listings SET name = ? WHERE slug = ?").run(listing.name, slug);
      database.prepare(`INSERT INTO owner_drafts (slug, owner_user_id, payload, updated_at)
        VALUES (?, ?, ?, ?) ON CONFLICT(slug) DO UPDATE SET payload = excluded.payload,
        updated_at = excluded.updated_at`).run(slug, userId, JSON.stringify(listing), new Date().toISOString());
    }
    return listing;
  }).immediate();
}

export function submitOwnerListing(userId: string, slug: string): ReviewSubmission {
  return database.transaction(() => {
    const current = ownedListing(userId, slug);
    if (pendingSubmission(slug)) throw new ModerationError(409, "Listing already awaits review");
    const draft = database.prepare("SELECT payload FROM owner_drafts WHERE slug = ?").get(slug) as { payload: string } | undefined;
    if (current.status !== "draft" && !draft) throw new ModerationError(400, "Save changes before submitting");
    const proposed = draft ? JSON.parse(draft.payload) as Listing : current;
    const id = randomUUID();
    const submittedAt = new Date().toISOString();
    database.prepare(`INSERT INTO submissions
      (id, slug, owner_user_id, payload, status, submitted_at)
      VALUES (?, ?, ?, ?, 'pending', ?)`).run(id, slug, userId, JSON.stringify(proposed), submittedAt);
    return {
      id, slug, ownerUserId: userId, ownerEmail: "", proposed,
      status: "pending" as const, reason: null, submittedAt, decidedAt: null,
      decidedBy: null, decidedByEmail: null, listingStatus: current.status,
    };
  }).immediate();
}

export function reviewSubmissions(page = 1): { submissions: ReviewSubmission[]; page: number; pages: number } {
  const total = (database.prepare("SELECT COUNT(*) AS count FROM submissions").get() as { count: number }).count;
  const pages = Math.max(1, Math.ceil(total / 50));
  const selectedPage = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  const rows = database.prepare(`SELECT s.*, l.status AS listing_status,
    owner.email AS owner_email, reviewer.email AS decided_by_email
    FROM submissions s
    LEFT JOIN listings l ON l.slug = s.slug
    LEFT JOIN "user" owner ON owner.id = s.owner_user_id
    LEFT JOIN "user" reviewer ON reviewer.id = s.decided_by
    WHERE s.status = 'pending'
    ORDER BY CASE WHEN s.status = 'pending' THEN 0 ELSE 1 END,
      s.submitted_at DESC, s.id DESC LIMIT 50 OFFSET ?`)
    .all((selectedPage - 1) * 50) as StoredSubmission[];
  return { submissions: rows.map(reviewSubmission), page: selectedPage, pages };
}

export function decideSubmission(id: string, actorId: string, decision: "approve" | "reject", reason: string): void {
  database.transaction(() => {
    const row = database.prepare("SELECT * FROM submissions WHERE id = ? AND status = 'pending'")
      .get(id) as StoredSubmission | undefined;
    if (!row) throw new ModerationError(404, "Pending submission not found");
    const current = database.prepare("SELECT * FROM listings WHERE slug = ? AND owner_user_id = ?")
      .get(row.slug, row.owner_user_id) as StoredListing | undefined;
    if (!current) throw new ModerationError(409, "Listing ownership changed");
    if (decision === "approve") {
      if (current.status === "suspended") throw new ModerationError(409, "Suspended listing cannot be approved");
      const proposed = JSON.parse(row.payload) as Listing;
      database.prepare("INSERT OR IGNORE INTO categories (name) VALUES (?)").run(proposed.category);
      database.prepare(`UPDATE listings SET name = ?, summary = ?, description = ?, category = ?,
        url = ?, status = 'published' WHERE slug = ? AND owner_user_id = ?`).run(
        proposed.name, proposed.summary, proposed.description, proposed.category,
        proposed.url, row.slug, row.owner_user_id,
      );
      database.prepare("DELETE FROM owner_drafts WHERE slug = ?").run(row.slug);
    }
    database.prepare(`UPDATE submissions SET status = ?, reason = ?, decided_at = ?, decided_by = ?
      WHERE id = ? AND status = 'pending'`).run(decision === "approve" ? "approved" : "rejected",
      reason, new Date().toISOString(), actorId, id);
  }).immediate();
}

export function suspendPublishedListing(slug: string, actorId: string, reason: string): void {
  database.transaction(() => {
    const changed = database.prepare("UPDATE listings SET status = 'published' WHERE slug = ? AND status = 'published'")
      .run(slug);
    if (changed.changes !== 1) throw new ModerationError(404, "Published listing not found");
    database.prepare(`UPDATE submissions SET status = 'rejected', reason = ?, decided_at = ?, decided_by = ?
      WHERE slug = ? AND status = 'pending'`).run(
      `Suspended: ${reason}`, new Date().toISOString(), actorId, slug,
    );
  }).immediate();
}
