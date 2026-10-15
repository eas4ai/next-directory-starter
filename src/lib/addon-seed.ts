import { randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { readAddonLock } from "../../scripts/addons/registry.mjs";
import { sha256, targetForPayload } from "../../scripts/addons/manifest.mjs";
import { parseDirectoryProfileDefinition, profileDigest,
  PROFILE_LIMITS } from "../../scripts/addons/profile-schema.mjs";
import { seedMediaDeclarations } from "../../scripts/addons/seed-media.mjs";
import { parseListing } from "@/lib/catalog-input";
import { database } from "@/lib/database";
import { activeDirectoryProfiles } from "@/lib/directory-profiles";
import { normalizeListingDestination } from "@/lib/listing-destinations";
import { drainMediaCleanupQueue, mediaFilePath, normalizeMediaImage } from "@/lib/media";
import { encodeProfileValue, replaceListingProfileValues,
  validateProfileValues } from "@/lib/profile-values";
import type { ActiveProfileSet, ValidatedProfileValues } from "@/lib/directory-profile-types";
import type { Listing } from "@/lib/listings";

type AddonSeedMedia = { source: string; field: string; alt: string };
type AddonSeedListing = Listing & { title: string; profileValues: Record<string, unknown>;
  media: AddonSeedMedia[] };
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
  const mediaByListing = new Map<number, AddonSeedMedia[]>();
  for (const declaration of seedMediaDeclarations(input)) {
    const media = mediaByListing.get(declaration.listingIndex) ?? [];
    media.push({ source: declaration.source, field: declaration.field, alt: declaration.alt });
    mediaByListing.set(declaration.listingIndex, media);
  }
  const listings = value.listings.map((record, index) => {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      throw new Error(`Invalid add-on seed listing at index ${index}`);
    }
    const candidate = record as Record<string, unknown>;
    const keys = candidate.media === undefined ? listingFields : [...listingFields, "media"];
    if (!exactKeys(candidate, keys) ||
        listingFields.slice(0, -1).some((field) => typeof candidate[field] !== "string") ||
        !candidate.profileValues || typeof candidate.profileValues !== "object" ||
        Array.isArray(candidate.profileValues)) {
      throw new Error(`Invalid add-on seed listing at index ${index}`);
    }
    const parsed = parseListing({ ...candidate, name: candidate.title, profileStateRevision: 0 });
    if (!parsed) throw new Error(`Invalid add-on seed listing at index ${index}`);
    return { ...parsed, title: candidate.title as string,
      profileValues: candidate.profileValues as Record<string, unknown>,
      media: mediaByListing.get(index) ?? [] };
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
  rawValues: Record<string, unknown>; media: AddonSeedMedia[]; destination: string };

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
  const fields = new Map(profiles.definitions.flatMap((definition) =>
    definition.fields.map((field) => [field.key, field])));
  const sources = new Set<string>();
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
    const mediaCounts = new Map<string, number>();
    for (const media of record.media) {
      const field = fields.get(media.field);
      if (!field || field.type !== "media") {
        throw new Error(`Seed media field does not accept photography: ${media.field}`);
      }
      if (Object.hasOwn(record.profileValues, media.field)) {
        throw new Error(`Seed media conflicts with a supplied profile value: ${media.field}`);
      }
      const count = (mediaCounts.get(media.field) ?? 0) + 1;
      if (field.cardinality === "one" && count > 1) {
        throw new Error(`Seed media field accepts only one image: ${media.field}`);
      }
      mediaCounts.set(media.field, count);
      if (sources.has(media.source)) throw new Error(`Duplicate seed media source: ${media.source}`);
      sources.add(media.source);
    }
    valueRows += normalizedRowCount(values, profiles) + record.media.length;
    if (valueRows > PROFILE_LIMITS.migrationRows) {
      throw new Error(`Add-on seed exceeds the ${PROFILE_LIMITS.migrationRows} value row limit`);
    }
    return { listing, values, rawValues: record.profileValues, media: record.media, destination };
  });
}

type PreparedSeedMedia = AddonSeedMedia & { id: string; itemId: string; output: Buffer;
  width: number; height: number; file: string };

const mimeByExtension = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
  webp: "image/webp" } as const;

async function prepareSeedMedia(root: string, addon: LockAddon,
  records: ValidatedSeedListing[]): Promise<Map<string, PreparedSeedMedia[]>> {
  const result = new Map<string, PreparedSeedMedia[]>();
  for (const record of records) {
    const prepared = [];
    for (const [index, media] of record.media.entries()) {
      const bytes = ownedBytes(root, addon.id, media.source, addon.files, "seed media");
      const extension = media.source.split(".").at(-1) as keyof typeof mimeByExtension;
      const normalized = await normalizeMediaImage(bytes, mimeByExtension[extension], media.alt);
      const id = randomUUID();
      prepared.push({ ...media, id, itemId: `seed-photo-${index + 1}`,
        output: normalized.output, width: normalized.width, height: normalized.height,
        file: mediaFilePath(id) });
    }
    result.set(record.listing.slug, prepared);
  }
  return result;
}

function seedDigest(seedBytes: Buffer, root: string, addon: LockAddon,
  records: ValidatedSeedListing[]): string {
  const parts = [seedBytes];
  for (const media of records.flatMap((record) => record.media)
    .sort((left, right) => left.source.localeCompare(right.source))) {
    const bytes = ownedBytes(root, addon.id, media.source, addon.files, "seed media");
    parts.push(Buffer.from(`\n${media.source}\0${sha256(bytes)}`, "utf8"));
  }
  return sha256(Buffer.concat(parts));
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

type SeedResult = { inserted: number; existing: number };

function seedStatements() {
  return {
    insertCategory: database.prepare("INSERT OR IGNORE INTO categories (name) VALUES (?)"),
    insertListing: database.prepare(`INSERT INTO listings
      (slug, name, summary, description, category, url, destination_key, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
    insertAsset: database.prepare(`INSERT INTO media_assets
      (id, target_kind, target_slug, uploaded_by, alt, width, height, created_at)
      VALUES (?, 'listing', ?, 'addon-seed', ?, ?, ?, ?)`),
    assignMedia: database.prepare(`INSERT INTO directory_profile_media
      (asset_id, listing_slug, field_key, item_id, state, uploaded_by, created_at)
      VALUES (?, ?, ?, ?, 'public', 'addon-seed', ?)`),
    clearCleanup: database.prepare("DELETE FROM media_cleanup_queue WHERE asset_id = ?"),
  };
}

type SeedStatements = ReturnType<typeof seedStatements>;

function queuePreparedMedia(prepared: Map<string, PreparedSeedMedia[]>): void {
  const queuedAt = new Date().toISOString();
  const queue = database.prepare(`INSERT OR IGNORE INTO media_cleanup_queue
    (asset_id, queued_at) VALUES (?, ?)`);
  for (const images of prepared.values()) for (const image of images) {
    queue.run(image.id, queuedAt);
  }
}

function writePreparedMedia(prepared: Map<string, PreparedSeedMedia[]>): void {
  for (const images of prepared.values()) for (const image of images) {
    mkdirSync(dirname(image.file), { recursive: true });
    writeFileSync(image.file, image.output, { flag: "wx" });
  }
}

function insertSeedListing(record: ValidatedSeedListing, images: PreparedSeedMedia[],
  profiles: ActiveProfileSet, statements: SeedStatements, now: string): void {
  const { listing, destination } = record;
  statements.insertCategory.run(listing.category);
  statements.insertListing.run(listing.slug, listing.name, listing.summary, listing.description,
    listing.category, listing.url, destination, listing.status);
  const rawValues = { ...record.rawValues };
  for (const image of images) {
    statements.insertAsset.run(image.id, listing.slug, image.alt, image.width, image.height, now);
    statements.assignMedia.run(image.id, listing.slug, image.field, image.itemId, now);
    const values = rawValues[image.field] as { id: string; value: string }[] | undefined;
    rawValues[image.field] = [...(values ?? []), { id: image.itemId, value: image.id }];
    statements.clearCleanup.run(image.id);
  }
  const values = validateProfileValues(rawValues, { profiles, authority: "system",
    listingSlug: listing.slug, actorUserId: "addon-seed", requireComplete: true });
  replaceListingProfileValues({ listingSlug: listing.slug, values, profiles });
}

type SeedCommitContext = {
  seed: AddonSeed;
  addon: LockAddon;
  profile: LockProfile;
  expectedProfiles: ActiveProfileSet;
  records: ValidatedSeedListing[];
  prepared: Map<string, PreparedSeedMedia[]>;
  digest: string;
};

function commitSeed({ seed, addon, profile, expectedProfiles, records, prepared,
  digest }: SeedCommitContext): SeedResult {
  return database.transaction(() => {
    const profiles = matchingActiveProfiles(seed.profile, profile.digest);
    if (profiles.state.revision !== expectedProfiles.state.revision) {
      throw new Error("Directory profile changed before the seed transaction");
    }
    const repeated = priorSeedRun(addon, digest);
    if (repeated !== null) return { inserted: 0, existing: repeated };
    requireNoCatalogConflicts(records);
    const now = new Date().toISOString();
    const statements = seedStatements();
    for (const record of records) {
      insertSeedListing(record, prepared.get(record.listing.slug) ?? [], profiles, statements, now);
    }
    database.prepare(`INSERT INTO directory_profile_seed_runs
      (addon_id, addon_version, seed_digest, profile_id, profile_version, record_count, applied_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(addon.id, addon.version, digest, profile.id, profile.version, records.length, now);
    return { inserted: records.length, existing: 0 };
  }).immediate();
}

function persistPreparedSeed(context: SeedCommitContext): SeedResult {
  drainMediaCleanupQueue();
  queuePreparedMedia(context.prepared);
  try {
    writePreparedMedia(context.prepared);
    const result = commitSeed(context);
    drainMediaCleanupQueue();
    return result;
  } catch (error) {
    drainMediaCleanupQueue();
    throw error;
  }
}

export async function seedInstalledAddon(rootInput: string, addonId: string): Promise<SeedResult> {
  const root = resolve(rootInput);
  const lock = readAddonLock(root) as AddonLock;
  const addon = lock.addons.find(({ id }) => id === addonId);
  if (!addon) throw new Error(`Add-on is not installed: ${addonId}`);
  if (!addon.seed) throw new Error(`Add-on does not declare sample data: ${addonId}`);
  const seedBytes = ownedBytes(root, addon.id, addon.seed, addon.files, "seed");
  let seedInput: unknown;
  try { seedInput = JSON.parse(seedBytes.toString("utf8")); }
  catch { throw new Error("Installed add-on seed is not valid JSON"); }
  const seed = parseAddonSeed(seedInput);
  const profile = installedProfile(root, addon, seed.profile);
  const profiles = matchingActiveProfiles(seed.profile, profile.digest);
  const records = validateSeedListings(seed, profiles);
  const digest = seedDigest(seedBytes, root, addon, records);
  const previous = priorSeedRun(addon, digest);
  if (previous !== null) return { inserted: 0, existing: previous };
  requireNoCatalogConflicts(records);
  const preparedMedia = await prepareSeedMedia(root, addon, records);
  return persistPreparedSeed({ seed, addon, profile, expectedProfiles: profiles, records,
    prepared: preparedMedia, digest });
}
