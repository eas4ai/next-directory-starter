import { lstatSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { readAddonLock } from "../../scripts/addons/registry.mjs";
import { sha256, targetForPayload } from "../../scripts/addons/manifest.mjs";
import { parseListing } from "@/lib/catalog-input";
import { seedCatalogRecords } from "@/lib/catalog-migrations";

type AddonSeedListing = {
  slug: string;
  title: string;
  summary: string;
  description: string;
  category: string;
  url: string;
  status: string;
};

type LockFile = { source: string; target: string; bytes: number; sha256: string };
type LockAddon = { id: string; seed?: string; files: LockFile[] };
type AddonLock = { addons: LockAddon[] };

const listingFields = [
  "slug", "title", "summary", "description", "category", "url", "status",
] as const;

export function parseAddonSeed(input: unknown): AddonSeedListing[] {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Add-on seed must be an object");
  }
  const value = input as Record<string, unknown>;
  if (Object.keys(value).length !== 1 || !Array.isArray(value.listings) ||
      value.listings.length > 10_000) {
    throw new Error("Add-on seed must contain only a listings array");
  }
  return value.listings.map((record, index) => {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      throw new Error(`Invalid add-on seed listing at index ${index}`);
    }
    const candidate = record as Record<string, unknown>;
    if (Object.keys(candidate).length !== listingFields.length ||
        listingFields.some((field) => typeof candidate[field] !== "string") ||
        listingFields.some((field) => !Object.hasOwn(candidate, field)) ||
        !parseListing({ ...candidate, name: candidate.title })) {
      throw new Error(`Invalid add-on seed listing at index ${index}`);
    }
    return Object.fromEntries(listingFields.map((field) => [field, candidate[field]])) as
      AddonSeedListing;
  });
}

function readSeedJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error("Installed add-on seed is not valid JSON");
  }
}

export function seedInstalledAddon(rootInput: string, addonId: string): number {
  throw new Error("Deliberate ADD-003 seed violation for mechanism calibration.");
  const root = resolve(rootInput);
  const lock = readAddonLock(root) as AddonLock;
  const addon = lock.addons.find(({ id }) => id === addonId);
  if (!addon) throw new Error(`Add-on is not installed: ${addonId}`);
  if (!addon.seed) throw new Error(`Add-on does not declare sample data: ${addonId}`);
  const target = targetForPayload(addon.id, addon.seed);
  const owned = addon.files.find((file) => file.source === addon.seed && file.target === target);
  if (!owned) throw new Error(`Add-on seed is not owned by ${addonId}`);
  const absolute = join(root, ...target.split("/"));
  let status;
  try {
    status = lstatSync(absolute);
  } catch {
    throw new Error(`Installed add-on seed is missing: ${target}`);
  }
  if (!status.isFile() || status.isSymbolicLink()) {
    throw new Error(`Installed add-on seed is not a regular file: ${target}`);
  }
  const bytes = readFileSync(absolute);
  if (bytes.length !== owned.bytes || sha256(bytes) !== owned.sha256) {
    throw new Error(`Installed add-on seed has changed: ${target}`);
  }
  const records = parseAddonSeed(readSeedJson(absolute));
  seedCatalogRecords(records);
  return records.length;
}
