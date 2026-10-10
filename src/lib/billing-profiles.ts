import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { database } from "@/lib/database";
import { migrateCatalog } from "@/lib/catalog-migrations";
import { recordAudit } from "@/lib/audit";
import { HttpError, httpErrorResponse } from "@/lib/http-error";
import { checkoutMode, type PublishingPlan } from "@/lib/plans";
import { publicUrl } from "@/lib/page-metadata";

migrateCatalog();

export type BillingProvider = "stripe" | "paddle" | "nowpayments";
export type BillingMode = "test" | "live";
export type PriceMapping = { planKey: string; priceId: string };
export type BillingProfile = {
  provider: BillingProvider;
  mode: BillingMode;
  version: number;
  enabled: boolean;
  publicKey: string;
  hasApiKey: boolean;
  hasWebhookSecret: boolean;
  priceMappings: PriceMapping[];
  updatedAt: string;
};
export type CheckoutConfiguration = {
  provider: BillingProvider;
  mode: BillingMode;
  apiKey: string;
  webhookSecret: string;
  publicKey: string;
  priceMappings: PriceMapping[];
  legacy: boolean;
};

type StoredProfile = {
  provider: BillingProvider; mode: BillingMode; version: number; enabled: number;
  public_key: string; api_key_cipher: string | null; webhook_secret_cipher: string | null;
  price_mappings: string; updated_at: string;
};

export class BillingProfileError extends HttpError {}
export const billingProfileErrorResponse = httpErrorResponse;

function encryptionKey(): Buffer {
  const encoded = process.env.BILLING_ENCRYPTION_KEY;
  if (!encoded || !/^[A-Za-z0-9_-]{43}$/.test(encoded)) {
    throw new BillingProfileError(503, "BILLING_ENCRYPTION_KEY must be a 32-byte base64url value");
  }
  const key = Buffer.from(encoded, "base64url");
  if (key.length !== 32 || key.toString("base64url") !== encoded) {
    throw new BillingProfileError(503, "BILLING_ENCRYPTION_KEY must be a 32-byte base64url value");
  }
  return key;
}

function seal(value: string, provider: BillingProvider, mode: BillingMode, field: string, key: Buffer): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(`${provider}:${mode}:${field}`));
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `v1:${Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString("base64url")}`;
}

function open(value: string, provider: BillingProvider, mode: BillingMode, field: string, key: Buffer): string {
  if (!value.startsWith("v1:")) throw new BillingProfileError(503, "Unsupported billing secret format");
  const payload = Buffer.from(value.slice(3), "base64url");
  if (payload.length < 29) throw new BillingProfileError(503, "Invalid billing secret");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, payload.subarray(0, 12));
    decipher.setAAD(Buffer.from(`${provider}:${mode}:${field}`));
    decipher.setAuthTag(payload.subarray(12, 28));
    return Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    throw new BillingProfileError(503, "BILLING_ENCRYPTION_KEY cannot read the saved billing secrets");
  }
}

function stored(provider: BillingProvider, mode: BillingMode): StoredProfile | undefined {
  return database.prepare("SELECT * FROM billing_profiles WHERE provider = ? AND mode = ?")
    .get(provider, mode) as StoredProfile | undefined;
}

function publicProfile(row: StoredProfile): BillingProfile {
  return {
    provider: row.provider, mode: row.mode, version: row.version,
    enabled: Boolean(row.enabled), publicKey: row.public_key,
    hasApiKey: Boolean(row.api_key_cipher), hasWebhookSecret: Boolean(row.webhook_secret_cipher),
    priceMappings: JSON.parse(row.price_mappings) as PriceMapping[], updatedAt: row.updated_at,
  };
}

export function listBillingProfiles(): BillingProfile[] {
  return (database.prepare("SELECT * FROM billing_profiles ORDER BY provider, mode")
    .all() as StoredProfile[]).map(publicProfile);
}

function provider(value: unknown): BillingProvider {
  if (value === "stripe" || value === "paddle" || value === "nowpayments") return value;
  throw new BillingProfileError(400, "Invalid billing provider");
}

function mode(value: unknown): BillingMode {
  if (value === "test" || value === "live") return value;
  throw new BillingProfileError(400, "Invalid checkout mode");
}

function textField(value: unknown, limit: number): string {
  if (typeof value !== "string" || value.length > limit || /[\u0000-\u001f]/.test(value)) {
    throw new BillingProfileError(400, "Invalid billing setting");
  }
  return value.trim();
}

function mappings(value: unknown, billingProvider: BillingProvider): PriceMapping[] {
  if (!Array.isArray(value) || value.length > 100 || (billingProvider === "nowpayments" && value.length)) {
    throw new BillingProfileError(400, "Invalid price mappings");
  }
  const seen = new Set<string>();
  return value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new BillingProfileError(400, "Invalid price mapping");
    }
    const row = entry as Record<string, unknown>;
    const planKey = textField(row.planKey, 64);
    const priceId = textField(row.priceId, 128);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(planKey) || !priceId || seen.has(planKey)) {
      throw new BillingProfileError(400, "Invalid or duplicate price mapping");
    }
    seen.add(planKey);
    return { planKey, priceId };
  });
}

export function saveBillingProfile(input: unknown, actorUserId: string): BillingProfile {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new BillingProfileError(400, "Invalid billing profile");
  }
  const value = input as Record<string, unknown>;
  const billingProvider = provider(value.provider);
  const billingMode = mode(value.mode);
  if (!Number.isSafeInteger(value.version) || Number(value.version) < 0 ||
      typeof value.enabled !== "boolean") {
    throw new BillingProfileError(400, "Invalid billing profile version or availability");
  }
  const key = encryptionKey();
  return database.transaction(() => {
    const current = stored(billingProvider, billingMode);
    if (Number(value.version) !== (current?.version ?? 0)) {
      throw new BillingProfileError(409, "Billing profile changed. Refresh before saving");
    }
    const publicKey = value.publicKey === undefined ? current?.public_key ?? "" :
      textField(value.publicKey, 256);
    const priceMappings = value.priceMappings === undefined
      ? current ? JSON.parse(current.price_mappings) as PriceMapping[] : []
      : mappings(value.priceMappings, billingProvider);
    const secret = (field: "apiKey" | "webhookSecret", storedValue: string | null) => {
      const supplied = value[field];
      if (supplied === undefined || supplied === "") return storedValue;
      if (supplied === null) return null;
      const clear = textField(supplied, 4096);
      if (!clear) throw new BillingProfileError(400, "Invalid billing secret");
      return seal(clear, billingProvider, billingMode, field, key);
    };
    const apiKeyCipher = secret("apiKey", current?.api_key_cipher ?? null);
    const webhookSecretCipher = secret("webhookSecret", current?.webhook_secret_cipher ?? null);
    const apiKey = apiKeyCipher ? open(apiKeyCipher, billingProvider, billingMode, "apiKey", key) : null;
    if (webhookSecretCipher) open(webhookSecretCipher, billingProvider, billingMode, "webhookSecret", key);
    if (billingProvider === "stripe" &&
        ((apiKey && !apiKey.startsWith(`sk_${billingMode}_`)) ||
          (publicKey && !publicKey.startsWith(`pk_${billingMode}_`)))) {
      throw new BillingProfileError(400, "Stripe keys must match the selected checkout mode");
    }
    if (value.enabled && (!apiKeyCipher || !webhookSecretCipher ||
        (billingProvider !== "nowpayments" && (!publicKey || !priceMappings.length)))) {
      throw new BillingProfileError(400, "Complete credentials and price mappings before enabling this provider");
    }
    const nextVersion = (current?.version ?? 0) + 1;
    const now = new Date().toISOString();
    database.prepare(`INSERT INTO billing_profiles
      (provider, mode, version, enabled, public_key, api_key_cipher, webhook_secret_cipher,
        price_mappings, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider, mode) DO UPDATE SET version = excluded.version,
        enabled = excluded.enabled, public_key = excluded.public_key,
        api_key_cipher = excluded.api_key_cipher,
        webhook_secret_cipher = excluded.webhook_secret_cipher,
        price_mappings = excluded.price_mappings, updated_at = excluded.updated_at`).run(
      billingProvider, billingMode, nextVersion, Number(value.enabled), publicKey,
      apiKeyCipher, webhookSecretCipher, JSON.stringify(priceMappings), now,
    );
    recordAudit("billing.profile.update", actorUserId, `${billingProvider}:${billingMode}`);
    return publicProfile(stored(billingProvider, billingMode)!);
  }).immediate();
}

function legacyStripe(): { mode: BillingMode; apiKey: string; webhookSecret: string } | null {
  const apiKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!apiKey || !webhookSecret) return null;
  const inferredMode = apiKey.startsWith("sk_live_") ? "live" : apiKey.startsWith("sk_test_") ? "test" : null;
  return inferredMode ? { mode: inferredMode, apiKey, webhookSecret } : null;
}

export function stripeCheckoutConfiguration(): { apiKey: string; webhookSecret: string } | null {
  const billingMode = checkoutMode();
  const profile = stored("stripe", billingMode);
  if (!profile) {
    const legacy = legacyStripe();
    return legacy?.mode === billingMode ? legacy : null;
  }
  if (!profile.enabled || !profile.api_key_cipher || !profile.webhook_secret_cipher) return null;
  const key = encryptionKey();
  return {
    apiKey: open(profile.api_key_cipher, "stripe", billingMode, "apiKey", key),
    webhookSecret: open(profile.webhook_secret_cipher, "stripe", billingMode, "webhookSecret", key),
  };
}

export function checkoutConfiguration(billingProvider: BillingProvider,
  billingMode: BillingMode = checkoutMode()): CheckoutConfiguration | null {
  const profile = stored(billingProvider, billingMode);
  if (!profile) {
    if (billingProvider !== "stripe") return null;
    const legacy = legacyStripe();
    return legacy?.mode === billingMode ? {
      provider: "stripe", mode: billingMode, apiKey: legacy.apiKey,
      webhookSecret: legacy.webhookSecret, publicKey: "", priceMappings: [], legacy: true,
    } : null;
  }
  if (!profile.enabled || !profile.api_key_cipher || !profile.webhook_secret_cipher) return null;
  const key = encryptionKey();
  return {
    provider: billingProvider, mode: billingMode,
    apiKey: open(profile.api_key_cipher, billingProvider, billingMode, "apiKey", key),
    webhookSecret: open(profile.webhook_secret_cipher, billingProvider, billingMode, "webhookSecret", key),
    publicKey: profile.public_key,
    priceMappings: JSON.parse(profile.price_mappings) as PriceMapping[], legacy: false,
  };
}

export function checkoutProvidersForPlan(plan: PublishingPlan): BillingProvider[] {
  if (!plan.enabled || plan.mode !== checkoutMode() || plan.billingMode === "free") return [];
  const providers: BillingProvider[] = ["stripe", "paddle", "nowpayments"];
  return providers.filter((billingProvider) => {
    if (billingProvider === "nowpayments") {
      if (plan.billingMode !== "one-time") return false;
      try { if (new URL(publicUrl("/")).protocol !== "https:") return false; }
      catch { return false; }
    }
    try {
      const configuration = checkoutConfiguration(billingProvider, plan.mode);
      if (!configuration) return false;
      return billingProvider === "nowpayments" ||
        configuration.priceMappings.some((entry) => entry.planKey === plan.key) ||
        (billingProvider === "stripe" && configuration.legacy && plan.billingMode === "one-time");
    } catch { return false; }
  });
}

export function stripeWebhookCandidates(): { mode: BillingMode; secret: string; profile: boolean }[] {
  const rows = database.prepare("SELECT * FROM billing_profiles WHERE provider = 'stripe'")
    .all() as StoredProfile[];
  const candidates: { mode: BillingMode; secret: string; profile: boolean }[] = [];
  for (const row of rows) {
    if (!row.webhook_secret_cipher) continue;
    candidates.push({ mode: row.mode, profile: true,
      secret: open(row.webhook_secret_cipher, "stripe", row.mode, "webhookSecret", encryptionKey()) });
  }
  const fallback = legacyStripe();
  if (fallback && !candidates.some((candidate) => candidate.mode === fallback.mode &&
      candidate.secret === fallback.webhookSecret)) {
    candidates.push({ mode: fallback.mode, secret: fallback.webhookSecret, profile: false });
  }
  return candidates;
}

export function providerWebhookSecret(billingProvider: Exclude<BillingProvider, "stripe">,
  billingMode: BillingMode): string | null {
  const profile = stored(billingProvider, billingMode);
  if (!profile?.webhook_secret_cipher) return null;
  return open(profile.webhook_secret_cipher, billingProvider, billingMode,
    "webhookSecret", encryptionKey());
}

export function providerRecoveryConfiguration(billingProvider: BillingProvider,
  billingMode: BillingMode): CheckoutConfiguration | null {
  const profile = stored(billingProvider, billingMode);
  if (profile?.api_key_cipher) {
    const key = encryptionKey();
    return {
      provider: billingProvider, mode: billingMode,
      apiKey: open(profile.api_key_cipher, billingProvider, billingMode, "apiKey", key),
      webhookSecret: profile.webhook_secret_cipher
        ? open(profile.webhook_secret_cipher, billingProvider, billingMode, "webhookSecret", key) : "",
      publicKey: profile.public_key,
      priceMappings: JSON.parse(profile.price_mappings) as PriceMapping[], legacy: false,
    };
  }
  const fallback = billingProvider === "stripe" ? legacyStripe() : null;
  return fallback?.mode === billingMode ? {
    provider: "stripe", mode: billingMode, apiKey: fallback.apiKey,
    webhookSecret: fallback.webhookSecret, publicKey: "", priceMappings: [], legacy: true,
  } : null;
}
