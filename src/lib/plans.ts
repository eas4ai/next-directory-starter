import { database } from "@/lib/database";
import { createHash } from "node:crypto";
import { migrateCatalog } from "@/lib/catalog-migrations";
import { recordAudit } from "@/lib/audit";
import { HttpError, httpErrorResponse } from "@/lib/http-error";

migrateCatalog();

export type PublishingPlan = {
  key: string;
  name: string;
  description: string;
  amountMinor: number;
  currency: string;
  durationDays: number;
  featured: boolean;
  enabled: boolean;
  updatedAt: string;
};

type PlanRow = {
  key: string; name: string; description: string; amount_minor: number;
  currency: string; duration_days: number; featured: number; enabled: number;
  updated_at: string;
};

export class PlanError extends HttpError {}
export const planErrorResponse = httpErrorResponse;

function fromRow(row: PlanRow): PublishingPlan {
  return {
    key: row.key, name: row.name, description: row.description,
    amountMinor: row.amount_minor, currency: row.currency,
    durationDays: row.duration_days, featured: Boolean(row.featured),
    enabled: Boolean(row.enabled), updatedAt: row.updated_at,
  };
}

function validate(input: unknown): Omit<PublishingPlan, "updatedAt"> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new PlanError(400, "Invalid plan");
  const value = input as Record<string, unknown>;
  const { key, name, description, amountMinor, currency, durationDays, featured, enabled } = value;
  if (typeof key !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key) || key.length > 64 ||
      typeof name !== "string" || !name.trim() || name.length > 120 ||
      typeof description !== "string" || description.length > 500 ||
      !Number.isSafeInteger(amountMinor) || Number(amountMinor) < 1 || Number(amountMinor) > 1_000_000_000 ||
      typeof currency !== "string" || !["usd", "eur", "gbp", "cad", "aud"].includes(currency.toLowerCase()) ||
      !Number.isSafeInteger(durationDays) || Number(durationDays) < 1 || Number(durationDays) > 3650 ||
      typeof featured !== "boolean" || typeof enabled !== "boolean") {
    throw new PlanError(400, "Invalid plan fields");
  }
  return {
    key, name: name.trim(), description: description.trim(),
    amountMinor: Number(amountMinor), currency: currency.toLowerCase(),
    durationDays: Number(durationDays), featured, enabled,
  };
}

export function listPlans(enabledOnly = false): PublishingPlan[] {
  const rows = database.prepare(`SELECT * FROM publishing_plans
    ${enabledOnly ? "WHERE enabled = 1" : ""} ORDER BY amount_minor, key`).all() as PlanRow[];
  return rows.map(fromRow);
}

export function planByKey(key: string): PublishingPlan | undefined {
  const row = database.prepare("SELECT * FROM publishing_plans WHERE key = ?").get(key) as PlanRow | undefined;
  return row ? fromRow(row) : undefined;
}

export function createPlan(input: unknown, actorUserId: string): PublishingPlan {
  const plan = validate(input);
  const now = new Date().toISOString();
  try {
    database.transaction(() => {
      database.prepare(`INSERT INTO publishing_plans
        (key, name, description, amount_minor, currency, duration_days, featured, enabled, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(plan.key, plan.name, plan.description,
        plan.amountMinor, plan.currency, plan.durationDays, Number(plan.featured), Number(plan.enabled), now);
      recordAudit("plan.create", actorUserId, plan.key);
    }).immediate();
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE constraint")) {
      throw new PlanError(409, "Plan key already exists");
    }
    throw error;
  }
  return planByKey(plan.key)!;
}

export function updatePlan(key: string, changes: unknown, actorUserId: string): PublishingPlan {
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) {
    throw new PlanError(400, "Invalid plan changes");
  }
  return database.transaction(() => {
    const current = planByKey(key);
    if (!current) throw new PlanError(404, "Plan not found");
    const plan = validate({ ...current, ...(changes as Record<string, unknown>), key });
    database.prepare(`UPDATE publishing_plans SET name = ?, description = ?, amount_minor = ?,
      currency = ?, duration_days = ?, featured = ?, enabled = ?, updated_at = ? WHERE key = ?`).run(
      plan.name, plan.description, plan.amountMinor, plan.currency, plan.durationDays,
      Number(plan.featured), Number(plan.enabled), new Date().toISOString(), key,
    );
    recordAudit("plan.update", actorUserId, key);
    return planByKey(key)!;
  }).immediate();
}

export function planPrice(plan: PublishingPlan): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: plan.currency.toUpperCase() })
    .format(plan.amountMinor / 100);
}

export function planOfferToken(plan: Pick<PublishingPlan,
  "key" | "amountMinor" | "currency" | "durationDays" | "featured">): string {
  return createHash("sha256").update(JSON.stringify([
    plan.key, plan.amountMinor, plan.currency, plan.durationDays, plan.featured,
  ])).digest("hex");
}
