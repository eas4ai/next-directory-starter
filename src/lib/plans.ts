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
  mode: "test" | "live";
  billingMode: "free" | "one-time" | "monthly" | "annual";
  amountMinor: number;
  currency: string;
  durationDays: number | null;
  featured: boolean;
  enabled: boolean;
  updatedAt: string;
};

type PlanRow = {
  key: string; name: string; description: string; amount_minor: number;
  mode: PublishingPlan["mode"]; billing_mode: PublishingPlan["billingMode"];
  currency: string; duration_days: number | null; featured: number; enabled: number;
  updated_at: string;
};

export class PlanError extends HttpError {}
export const planErrorResponse = httpErrorResponse;

function fromRow(row: PlanRow): PublishingPlan {
  return {
    key: row.key, name: row.name, description: row.description,
    mode: row.mode, billingMode: row.billing_mode,
    amountMinor: row.amount_minor, currency: row.currency,
    durationDays: row.duration_days, featured: Boolean(row.featured),
    enabled: Boolean(row.enabled), updatedAt: row.updated_at,
  };
}

function validate(input: unknown): Omit<PublishingPlan, "updatedAt"> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new PlanError(400, "Invalid plan");
  const value = input as Record<string, unknown>;
  const { key, name, description, amountMinor, currency, durationDays, featured, enabled } = value;
  const mode = value.mode ?? checkoutMode();
  const billingMode = value.billingMode ?? "one-time";
  const price = typeof amountMinor === "number" ? amountMinor : NaN;
  const duration = typeof durationDays === "number" ? durationDays : NaN;
  if (typeof key !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key) || key.length > 64 ||
      typeof name !== "string" || !name.trim() || name.length > 120 ||
      typeof description !== "string" || description.length > 500 ||
      (mode !== "test" && mode !== "live") ||
      !["free", "one-time", "monthly", "annual"].includes(String(billingMode)) ||
      !Number.isSafeInteger(price) || price < 0 || price > 1_000_000_000 ||
      typeof currency !== "string" || !["usd", "eur", "gbp", "cad", "aud"].includes(currency.toLowerCase()) ||
      (billingMode === "one-time"
        ? !Number.isSafeInteger(duration) || duration < 1 || duration > 3650
        : durationDays !== null) ||
      (billingMode === "free" ? price !== 0 : price < 1) ||
      typeof featured !== "boolean" || typeof enabled !== "boolean") {
    throw new PlanError(400, "Invalid plan fields");
  }
  return {
    key, name: name.trim(), description: description.trim(),
    mode: mode as PublishingPlan["mode"], billingMode: billingMode as PublishingPlan["billingMode"],
    amountMinor: price, currency: currency.toLowerCase(),
    durationDays: billingMode === "one-time" ? duration : null, featured, enabled,
  };
}

export function checkoutMode(): PublishingPlan["mode"] {
  if (process.env.BILLING_CHECKOUT_MODE === "live") return "live";
  if (process.env.BILLING_CHECKOUT_MODE === "test") return "test";
  return process.env.STRIPE_SECRET_KEY?.startsWith("sk_live_") ? "live" : "test";
}

export function listPlans(enabledOnly = false, mode?: PublishingPlan["mode"]): PublishingPlan[] {
  const rows = database.prepare(`SELECT * FROM publishing_plans
    WHERE (? = 0 OR enabled = 1) AND (? IS NULL OR mode = ?)
    ORDER BY amount_minor, key`).all(Number(enabledOnly), mode ?? null, mode ?? null) as PlanRow[];
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
        (key, name, description, mode, billing_mode, amount_minor, currency, duration_days,
          featured, enabled, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(plan.key, plan.name, plan.description,
        plan.mode, plan.billingMode, plan.amountMinor, plan.currency, plan.durationDays,
        Number(plan.featured), Number(plan.enabled), now);
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
    database.prepare(`UPDATE publishing_plans SET name = ?, description = ?, mode = ?, billing_mode = ?,
      amount_minor = ?, currency = ?, duration_days = ?, featured = ?, enabled = ?, updated_at = ? WHERE key = ?`).run(
      plan.name, plan.description, plan.mode, plan.billingMode, plan.amountMinor, plan.currency, plan.durationDays,
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
  "key" | "name" | "description" | "mode" | "billingMode" | "amountMinor" | "currency" | "durationDays" | "featured">): string {
  return createHash("sha256").update(JSON.stringify([
    plan.key, plan.name, plan.description, plan.mode, plan.billingMode,
    plan.amountMinor, plan.currency, plan.durationDays, plan.featured,
  ])).digest("hex");
}
