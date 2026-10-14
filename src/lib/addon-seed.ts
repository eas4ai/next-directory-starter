import { lstatSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { readAddonLock } from "../../scripts/addons/registry.mjs";
import { sha256, targetForPayload } from "../../scripts/addons/manifest.mjs";
import { parseDirectoryProfileDefinition, profileDigest,
  PROFILE_LIMITS } from "../../scripts/addons/profile-schema.mjs";
import { parseListing } from "@/lib/catalog-input";
import { database } from "@/lib/database";
import { activeDirectoryProfiles } from "@/lib/directory-profiles";
import { normalizeListingDestination } from "@/lib/listing-destinations";
import { encodeProfileValue, replaceListingProfileValues,
  validateProfileValues } from "@/lib/profile-values";
import type { ActiveProfileSet, ValidatedProfileValues } from "@/lib/directory-profile-types";
import type { Listing } from "@/lib/listings";

type AddonSeedListing = Listing & { title: string; profileValues: Record<string, unknown> };
type AddonSeed = {
  profile: { id: string; version: string };
  listings: AddonSeedListing[];
};

type LockFile = { source: string; target: string; bytes: number; sha256: string };
type LockProfile = { id: string; version: string; schema: string; digest: string };
type LockAddon = { id: string; version: string; seed?: string; profiles?: LockProfile[];
  files: LockFile[] };
type AddonLock = { addons: LockAddon[] };

const listingFields = [
  "slug", "title", "summary", "description", "category", "url", "status", "profileValues",
] as const;

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

export function parseAddonSeed(input: unknown): AddonSeed {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Add-on seed must be an object");
  }
  const value = input as Record<string, unknown>;
  const profile = value.profile;
  if (!exactKeys(value, ["profile", "listings"]) || !profile ||
      typeof profile !== "object" || Array.isArray(profile) ||
      !exactKeys(profile as Record<string, unknown>, ["id", "version"]) ||
      typeof (profile as Record<string, unknown>).id !== "string" ||
      typeof (profile as Record<string, unknown>).version !== "string" ||
      !Array.isArray(value.listings) || value.listings.length > 10_000) {
    throw new Error("Add-on seed must contain one profile identity and a listings array");
  }
  const identity = profile as { id: string; version: string };
  const listings = value.listings.map((record, index) => {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      throw new Error(`Invalid add-on seed listing at index ${index}`);
    }
    const candidate = record as Record<string, unknown>;
    if (!exactKeys(candidate, listingFields) ||
        listingFields.slice(0, -1).some((field) => typeof candidate[field] !== "string") ||
        !candidate.profileValues || typeof candidate.profileValues !== "object" ||
        Array.isArray(candidate.profileValues)) {
      throw new Error(`Invalid add-on seed listing at index ${index}`);
    }
    const parsed = parseListing({ ...candidate, name: candidate.title, profileStateRevision: 0 });
    if (!parsed) throw new Error(`Invalid add-on seed listing at index ${index}`);
    return { ...parsed, title: candidate.title as string,
      profileValues: candidate.profileValues as Record<string, unknown> };
  });
  return { profile: identity, listings };
}

function ownedBytes(root: string, addonId: string, source: string,
  files: LockFile[], label: string): Buffer {
  const target = targetForPayload(addonId, source);
  const owned = files.find((file) => file.source === source && file.target === target);
  if (!owned) throw new Error(`Add-on ${label} is not owned by ${addonId}`);
  const absolute = join(root, ...target.split("/"));
  let status;
  try { status = lstatSync(absolute); }
  catch { throw new Error(`Installed add-on ${label} is missing: ${target}`); }
  if (!status.isFile() || status.isSymbolicLink()) {
    throw new Error(`Installed add-on ${label} is not a regular file: ${target}`);
  }
  const bytes = readFileSync(absolute);
  if (bytes.length !== owned.bytes || sha256(bytes) !== owned.sha256) {
    throw new Error(`Installed add-on ${label} has changed: ${target}`);
  }
  return bytes;
}

function installedProfile(root: string, addon: LockAddon,
  identity: AddonSeed["profile"]): LockProfile {
  const profile = addon.profiles?.find(({ id, version }) =>
    id === identity.id && version === identity.version);
  if (!profile) throw new Error(`Seed profile is not declared by ${addon.id}: ` +
    `${identity.id}@${identity.version}`);
  const bytes = ownedBytes(root, addon.id, profile.schema, addon.files, "profile schema");
  if (bytes.length > PROFILE_LIMITS.fileBytes) throw new Error("Installed profile schema is too large");
  let input;
  try { input = JSON.parse(bytes.toString("utf8")); }
  catch { throw new Error("Installed profile schema is not valid JSON"); }
  const definition = parseDirectoryProfileDefinition(input);
  if (definition.id !== profile.id || definition.version !== profile.version ||
      profileDigest(definition) !== profile.digest) {
    throw new Error("Installed profile identity, version, or digest has changed");
  }
  return profile;
}

function matchingActiveProfiles(identity: AddonSeed["profile"], digest: string): ActiveProfileSet {
  const profiles = activeDirectoryProfiles();
  const active = profiles.state.base;
  if (!active || active.profileId !== identity.id || active.version !== identity.version ||
      active.digest !== digest) {
    throw new Error(`Seed profile must be the active stored version: ${identity.id}@${identity.version}`);
  }
  return profiles;
}

type ValidatedSeedListing = { listing: Listing; values: ValidatedProfileValues;
  destination: string };

function normalizedRowCount(values: ValidatedProfileValues, profiles: ActiveProfileSet): number {
  const fields = new Map(profiles.definitions.flatMap((definition) =>
    definition.fields.map((field) => [field.key, field])));
  let count = 0;
  for (const [key, value] of Object.entries(values)) {
    const field = fields.get(key);
    if (!field) throw new Error(`Unknown validated profile field: ${key}`);
    count += encodeProfileValue(field, value).length;
  }
  return count;
}

function validateSeedListings(seed: AddonSeed, profiles: ActiveProfileSet): ValidatedSeedListing[] {
  const slugs = new Set<string>();
  const destinations = new Set<string>();
  let valueRows = 0;
  return seed.listings.map((record, index) => {
    const listing = parseListing({ ...record, name: record.title,
      profileStateRevision: profiles.state.revision });
    if (!listing) throw new Error(`Invalid add-on seed listing at index ${index}`);
    const destination = normalizeListingDestination(listing.url);
    if (slugs.has(listing.slug)) throw new Error(`Duplicate seed listing slug: ${listing.slug}`);
    if (destinations.has(destination)) {
      throw new Error(`Duplicate seed listing destination: ${destination}`);
    }
    slugs.add(listing.slug);
    destinations.add(destination);
    const values = validateProfileValues(record.profileValues, { profiles,
      authority: "system", listingSlug: listing.slug, actorUserId: "addon-seed",
      requireComplete: true });
    valueRows += normalizedRowCount(values, profiles);
    if (valueRows > PROFILE_LIMITS.migrationRows) {
      throw new Error(`Add-on seed exceeds the ${PROFILE_LIMITS.migrationRows} value row limit`);
    }
    return { listing, values, destination };
  });
}

function requireNoCatalogConflicts(records: ValidatedSeedListing[]): void {
  const bySlug = database.prepare("SELECT 1 FROM listings WHERE slug = ?");
  const byDestination = database.prepare(`SELECT 1 FROM listings
    WHERE destination_key = ? OR url = ? LIMIT 1`);
  const legacy = (database.prepare(`SELECT url FROM listings
    WHERE destination_key IS NULL`).all() as { url: string }[]).flatMap(({ url }) => {
      try { return [normalizeListingDestination(url)]; } catch { return []; }
    });
  const legacyDestinations = new Set(legacy);
  for (const { listing, destination } of records) {
    if (bySlug.get(listing.slug)) throw new Error(`Seed listing slug already exists: ${listing.slug}`);
    if (byDestination.get(destination, listing.url) || legacyDestinations.has(destination)) {
      throw new Error(`Seed listing destination already exists: ${destination}`);
    }
  }
}

function priorSeedRun(addon: LockAddon, seedDigest: string): number | null {
  const rows = database.prepare(`SELECT seed_digest, record_count
    FROM directory_profile_seed_runs WHERE addon_id = ? AND addon_version = ?`)
    .all(addon.id, addon.version) as { seed_digest: string; record_count: number }[];
  if (!rows.length) return null;
  const same = rows.find(({ seed_digest }) => seed_digest === seedDigest);
  if (!same) throw new Error(`A different seed digest was already applied for ${addon.id}@${addon.version}`);
  return same.record_count;
}

export function seedInstalledAddon(rootInput: string, addonId: string): {
  inserted: number; existing: number;
} {
  const root = resolve(rootInput);
  const lock = readAddonLock(root) as AddonLock;
  const addon = lock.addons.find(({ id }) => id === addonId);
  if (!addon) throw new Error(`Add-on is not installed: ${addonId}`);
  if (!addon.seed) throw new Error(`Add-on does not declare sample data: ${addonId}`);
  const seedBytes = ownedBytes(root, addon.id, addon.seed, addon.files, "seed");
  const seedDigest = sha256(seedBytes);
  let seedInput: unknown;
  try { seedInput = JSON.parse(seedBytes.toString("utf8")); }
  catch { throw new Error("Installed add-on seed is not valid JSON"); }
  const seed = parseAddonSeed(seedInput);
  const profile = installedProfile(root, addon, seed.profile);
  const profiles = matchingActiveProfiles(seed.profile, profile.digest);
  const previous = priorSeedRun(addon, seedDigest);
  if (previous !== null) return { inserted: 0, existing: previous };
  const records = validateSeedListings(seed, profiles);
  requireNoCatalogConflicts(records);

  return database.transaction(() => {
    const active = matchingActiveProfiles(seed.profile, profile.digest);
    if (active.state.revision !== profiles.state.revision) {
      throw new Error("Directory profile changed before the seed transaction");
    }
    const repeated = priorSeedRun(addon, seedDigest);
    if (repeated !== null) return { inserted: 0, existing: repeated };
    requireNoCatalogConflicts(records);
    const insertCategory = database.prepare("INSERT OR IGNORE INTO categories (name) VALUES (?)");
    const insertListing = database.prepare(`INSERT INTO listings
      (slug, name, summary, description, category, url, destination_key, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const { listing, values, destination } of records) {
      insertCategory.run(listing.category);
      insertListing.run(listing.slug, listing.name, listing.summary, listing.description,
        listing.category, listing.url, destination, listing.status);
      replaceListingProfileValues({ listingSlug: listing.slug, values, profiles: active });
    }
    database.prepare(`INSERT INTO directory_profile_seed_runs
      (addon_id, addon_version, seed_digest, profile_id, profile_version, record_count, applied_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(addon.id, addon.version, seedDigest, profile.id, profile.version,
        records.length, new Date().toISOString());
    return { inserted: records.length, existing: 0 };
  }).immediate();
}
