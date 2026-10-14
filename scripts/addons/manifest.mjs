import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import semver from "semver";
import { z } from "zod";

export const ADDON_SCHEMA_VERSION = 1;
export const ADDON_API_VERSION = 1;
export const MANIFEST_NAME = "directory-addon.json";
export const INTEGRITY_NAME = ".integrity.json";
export const MAX_FILES = 512;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_PACKAGE_BYTES = 50 * 1024 * 1024;

const idPattern = /^[a-z][a-z0-9-]*$/;
const payloadPattern = /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/;

const identity = z.string().min(1).max(80).regex(idPattern);
const displayName = z.string().trim().min(1).max(120);
const payloadPath = z.string().min(1).max(240).superRefine((value, context) => {
  try {
    normalizePayloadPath(value);
  } catch (error) {
    context.addIssue({ code: "custom", message: error.message });
  }
});

const themeSchema = z.object({
  id: identity,
  name: displayName,
  entry: payloadPath,
}).strict();

const templateSchema = z.object({
  id: identity,
  name: displayName,
  stylesheet: payloadPath,
}).strict();

const manifestSchema = z.object({
  schemaVersion: z.literal(ADDON_SCHEMA_VERSION),
  id: identity,
  name: displayName,
  version: z.string().refine((value) => semver.valid(value) !== null, "Invalid add-on version"),
  compatibility: z.object({
    starter: z.string().min(1).max(120)
      .refine((value) => semver.validRange(value) !== null, "Invalid starter range"),
    addonApi: z.literal(ADDON_API_VERSION),
  }).strict(),
  themes: z.array(themeSchema).max(40),
  templates: z.array(templateSchema).max(40),
  assets: z.array(payloadPath).max(200),
  seed: payloadPath.optional(),
  files: z.array(payloadPath).min(1).max(MAX_FILES),
}).strict();

const integrityFileSchema = z.object({
  path: z.string().min(1).max(240),
  bytes: z.number().int().min(0).max(MAX_FILE_BYTES),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export const integritySchema = z.object({
  schemaVersion: z.literal(1),
  files: z.array(integrityFileSchema).min(2).max(MAX_FILES + 1),
}).strict();

function unique(values, label) {
  if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label}`);
}

function ordered(values, key) {
  return [...values].sort((left, right) => key(left).localeCompare(key(right)));
}

export function normalizePayloadPath(value) {
  if (typeof value !== "string" || value !== value.normalize("NFC") ||
      value.includes("\\") || value.startsWith("/") || value.endsWith("/") ||
      value.includes("\0") || !payloadPattern.test(value) ||
      value.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error(`Unsafe payload path: ${String(value)}`);
  }
  return value;
}

export function targetForPayload(addonId, value) {
  const path = normalizePayloadPath(value);
  if (path.startsWith("src/")) return `src/addons/${addonId}/${path.slice(4)}`;
  if (path.startsWith("public/")) return `public/addons/${addonId}/${path.slice(7)}`;
  if (path.startsWith("seed/")) return `src/addons/${addonId}/seed/${path.slice(5)}`;
  throw new Error(`Unsupported payload root: ${path}`);
}

export function parseManifest(input) {
  const parsed = manifestSchema.parse(input);
  if (parsed.themes.length + parsed.templates.length === 0) {
    throw new Error("An add-on must declare a theme or template");
  }
  unique(parsed.files, "payload path");
  unique(parsed.themes.map(({ id }) => id), "theme ID");
  unique(parsed.templates.map(({ id }) => id), "template ID");
  unique(parsed.assets, "asset path");

  const files = new Set(parsed.files);
  for (const theme of parsed.themes) {
    if (!theme.entry.startsWith("src/") || !theme.entry.endsWith(".ts") ||
        !files.has(theme.entry)) {
      throw new Error(`Theme entry is not a declared TypeScript payload: ${theme.entry}`);
    }
  }
  for (const template of parsed.templates) {
    if (!template.stylesheet.startsWith("src/") || !template.stylesheet.endsWith(".css") ||
        !files.has(template.stylesheet)) {
      throw new Error(`Template stylesheet is not a declared CSS payload: ${template.stylesheet}`);
    }
  }
  for (const asset of parsed.assets) {
    if (!asset.startsWith("public/") || !files.has(asset)) {
      throw new Error(`Asset is not a declared public payload: ${asset}`);
    }
  }
  if (parsed.seed && (!parsed.seed.startsWith("seed/") || !parsed.seed.endsWith(".json") ||
      !files.has(parsed.seed))) {
    throw new Error(`Seed is not a declared JSON payload: ${parsed.seed}`);
  }

  const targets = parsed.files.map((path) => targetForPayload(parsed.id, path));
  unique(targets, "workspace target");
  return {
    ...parsed,
    themes: ordered(parsed.themes, ({ id }) => id),
    templates: ordered(parsed.templates, ({ id }) => id),
    assets: [...parsed.assets].sort(),
    files: [...parsed.files].sort(),
  };
}

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function canonicalJson(value) {
  function canonical(input) {
    if (Array.isArray(input)) return input.map(canonical);
    if (input && typeof input === "object") {
      return Object.fromEntries(Object.keys(input).sort()
        .map((key) => [key, canonical(input[key])]));
    }
    return input;
  }
  return Buffer.from(`${JSON.stringify(canonical(value), null, 2)}\n`);
}

function sourceFilePaths(root) {
  const paths = [];
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      const path = relative(root, absolute).split(sep).join("/");
      if (entry.isSymbolicLink()) throw new Error(`Linked payload is not allowed: ${path}`);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) paths.push(normalizePayloadPath(path));
      else throw new Error(`Unsupported payload entry: ${path}`);
    }
  }
  visit(root);
  return paths.sort();
}

export function readSourcePackage(source) {
  const root = resolve(source);
  const rootStatus = lstatSync(root);
  if (!rootStatus.isDirectory() || rootStatus.isSymbolicLink()) {
    throw new Error("Add-on source must be a real directory");
  }
  const manifestPath = join(root, MANIFEST_NAME);
  const manifestStatus = lstatSync(manifestPath);
  if (!manifestStatus.isFile() || manifestStatus.isSymbolicLink()) {
    throw new Error(`${MANIFEST_NAME} must be a regular file`);
  }
  const manifest = parseManifest(JSON.parse(readFileSync(manifestPath, "utf8")));
  const actual = sourceFilePaths(root);
  const expected = [MANIFEST_NAME, ...manifest.files].sort();
  if (actual.length !== expected.length || actual.some((path, index) => path !== expected[index])) {
    throw new Error("Source files must exactly match the manifest payload list");
  }
  let total = 0;
  const files = new Map();
  for (const path of manifest.files) {
    const absolute = join(root, ...path.split("/"));
    const status = lstatSync(absolute);
    if (!status.isFile() || status.isSymbolicLink()) throw new Error(`Payload is not a file: ${path}`);
    if (status.size > MAX_FILE_BYTES) throw new Error(`Payload is too large: ${path}`);
    total += status.size;
    if (total > MAX_PACKAGE_BYTES) throw new Error("Add-on payload is too large");
    files.set(path, readFileSync(absolute));
  }
  return { manifest, files, manifestBytes: canonicalJson(manifest), root };
}

export function readStarterIdentity(root = process.cwd()) {
  const packagePath = join(resolve(root), "package.json");
  const value = JSON.parse(readFileSync(packagePath, "utf8"));
  if (!semver.valid(value.version) || !Number.isInteger(value.directoryStarter?.addonApi) ||
      value.directoryStarter.addonApi < 1) {
    throw new Error("The current directory is not an add-on compatible starter");
  }
  return { version: value.version, addonApi: value.directoryStarter.addonApi };
}

export function validateCompatibility(manifest, starter) {
  if (!semver.satisfies(starter.version, manifest.compatibility.starter,
    { includePrerelease: true })) {
    throw new Error(`Add-on requires starter ${manifest.compatibility.starter}; found ${starter.version}`);
  }
  if (starter.addonApi !== manifest.compatibility.addonApi) {
    throw new Error(`Add-on API ${manifest.compatibility.addonApi} is incompatible with ${starter.addonApi}`);
  }
}
