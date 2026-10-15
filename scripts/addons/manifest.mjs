import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import semver from "semver";
import ts from "typescript";
import { z } from "zod";
import {
  PROFILE_LIMITS, parseDirectoryProfileDefinition, profileDigest,
} from "./profile-schema.mjs";

export const ADDON_SCHEMA_VERSION = 1;
export const ADDON_API_VERSION = 1;
export const MANIFEST_NAME = "directory-addon.json";
export const INTEGRITY_NAME = ".integrity.json";
export const MAX_FILES = 512;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_PACKAGE_BYTES = 50 * 1024 * 1024;
export const MAX_ARCHIVE_BYTES = MAX_PACKAGE_BYTES + 2 * 1024 * 1024;

const idPattern = /^[a-z][a-z0-9-]*$/;
const profileIdPattern = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;
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
  supportedProfiles: z.array(z.object({
    id: z.string().min(3).max(160).regex(profileIdPattern),
    range: z.string().min(1).max(120)
      .refine((value) => semver.validRange(value) !== null, "Invalid profile version range"),
  }).strict()).max(40).default([]),
}).strict();

const profileSchema = z.object({
  id: z.string().min(3).max(160).regex(profileIdPattern)
    .refine((value) => !value.startsWith("site."), "The site profile namespace is reserved"),
  version: z.string().refine((value) => semver.valid(value) !== null, "Invalid profile version"),
  schema: payloadPath,
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
  profiles: z.array(profileSchema).max(40).default([]),
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

function validateTemplateDeclaration(template, profiles, files) {
  if (!template.stylesheet.startsWith("src/") || !template.stylesheet.endsWith(".css") ||
      !files.has(template.stylesheet)) {
    throw new Error(`Template stylesheet is not a declared CSS payload: ${template.stylesheet}`);
  }
  unique(template.supportedProfiles.map(({ id }) => id),
    `supported profile ID for template ${template.id}`);
  for (const supported of template.supportedProfiles) {
    const packaged = profiles.find(({ id }) => id === supported.id);
    if (packaged && !semver.satisfies(packaged.version, supported.range,
      { includePrerelease: true })) {
      throw new Error(`Template ${template.id} is incompatible with packaged profile ` +
        `${packaged.id}@${packaged.version}`);
    }
  }
}

function validateAssetAndSeedDeclarations(parsed, files) {
  for (const asset of parsed.assets) {
    if (!asset.startsWith("public/") || !files.has(asset)) {
      throw new Error(`Asset is not a declared public payload: ${asset}`);
    }
  }
  if (parsed.seed && (!parsed.seed.startsWith("seed/") || !parsed.seed.endsWith(".json") ||
      !files.has(parsed.seed))) {
    throw new Error(`Seed is not a declared JSON payload: ${parsed.seed}`);
  }
}

function validateManifestPayloads(parsed) {
  const files = new Set(parsed.files);
  for (const theme of parsed.themes) {
    if (!theme.entry.startsWith("src/") || !theme.entry.endsWith(".ts") ||
        !files.has(theme.entry)) {
      throw new Error(`Theme entry is not a declared TypeScript payload: ${theme.entry}`);
    }
  }
  for (const template of parsed.templates) {
    validateTemplateDeclaration(template, parsed.profiles, files);
  }
  for (const profile of parsed.profiles) {
    if (!profile.schema.startsWith("src/") || !profile.schema.endsWith(".profile.json") ||
        !files.has(profile.schema)) {
      throw new Error(`Profile schema is not a declared src/*.profile.json payload: ${profile.schema}`);
    }
  }
  validateAssetAndSeedDeclarations(parsed, files);
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
  unique(parsed.profiles.map(({ id }) => id), "profile ID");
  unique(parsed.assets, "asset path");

  validateManifestPayloads(parsed);

  const targets = parsed.files.map((path) => targetForPayload(parsed.id, path));
  unique(targets, "workspace target");
  return {
    ...parsed,
    themes: ordered(parsed.themes, ({ id }) => id),
    templates: ordered(parsed.templates.map((template) => ({ ...template,
      supportedProfiles: ordered(template.supportedProfiles, ({ id }) => id) })), ({ id }) => id),
    profiles: ordered(parsed.profiles, ({ id }) => id),
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

function unwrapExpression(input) {
  let expression = input;
  while (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) ||
      ts.isSatisfiesExpression(expression) || ts.isTypeAssertionExpression(expression)) {
    expression = expression.expression;
  }
  return expression;
}

function objectPropertyName(property) {
  if (!property.name) return null;
  if (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) {
    return property.name.text;
  }
  return null;
}

function themeObject(sourceFile, path) {
  const assignments = sourceFile.statements.filter((statement) =>
    ts.isExportAssignment(statement) && !statement.isExportEquals);
  if (assignments.length !== 1) throw new Error(`Theme must have one default export: ${path}`);
  let expression = unwrapExpression(assignments[0].expression);
  if (ts.isIdentifier(expression)) {
    const declaration = sourceFile.statements.filter(ts.isVariableStatement)
      .flatMap(({ declarationList }) => [...declarationList.declarations])
      .find((candidate) => ts.isIdentifier(candidate.name) && candidate.name.text === expression.text);
    if (!declaration?.initializer) throw new Error(`Theme default export is not defined: ${path}`);
    expression = unwrapExpression(declaration.initializer);
  }
  if (!ts.isObjectLiteralExpression(expression)) {
    throw new Error(`Theme default export must be an object literal: ${path}`);
  }
  if (expression.properties.some(ts.isSpreadAssignment)) {
    throw new Error(`Theme default export cannot contain spreads: ${path}`);
  }
  return expression;
}

function literalProperty(object, name, path) {
  const matches = object.properties.filter((property) => objectPropertyName(property) === name);
  if (matches.length !== 1 || !ts.isPropertyAssignment(matches[0])) {
    throw new Error(`Theme must declare one literal ${name}: ${path}`);
  }
  const expression = unwrapExpression(matches[0].initializer);
  if (!ts.isStringLiteral(expression) && !ts.isNoSubstitutionTemplateLiteral(expression)) {
    throw new Error(`Theme ${name} must be a string literal: ${path}`);
  }
  return expression.text;
}

export function validateThemeModules(manifest, files) {
  const required = new Set([
    "id", "name", "light", "dark", "typography", "radius", "shadow", "controlHeight",
    "spacing", "width", "social",
  ]);
  for (const theme of manifest.themes) {
    const bytes = files.get(theme.entry);
    if (!bytes) throw new Error(`Theme entry is missing: ${theme.entry}`);
    const source = bytes.toString("utf8");
    if (!Buffer.from(source, "utf8").equals(bytes)) {
      throw new Error(`Theme entry is not UTF-8: ${theme.entry}`);
    }
    const sourceFile = ts.createSourceFile(theme.entry, source, ts.ScriptTarget.Latest, true,
      ts.ScriptKind.TS);
    if (sourceFile.parseDiagnostics.length > 0) {
      throw new Error(`Theme entry is not valid TypeScript: ${theme.entry}`);
    }
    const object = themeObject(sourceFile, theme.entry);
    const names = new Set(object.properties.map(objectPropertyName).filter(Boolean));
    if ([...required].some((name) => !names.has(name))) {
      throw new Error(`Theme entry is missing required fields: ${theme.entry}`);
    }
    if (literalProperty(object, "id", theme.entry) !== theme.id ||
        literalProperty(object, "name", theme.entry) !== theme.name) {
      throw new Error(`Theme identity does not match the manifest: ${theme.entry}`);
    }
  }
}

export function validateProfileDefinitions(manifest, files) {
  return manifest.profiles.map((profile) => {
    const bytes = files.get(profile.schema);
    if (!bytes) throw new Error(`Profile schema is missing: ${profile.schema}`);
    if (bytes.length > PROFILE_LIMITS.fileBytes) {
      throw new Error(`Profile schema exceeds the 256 KiB limit: ${profile.schema}`);
    }
    const source = bytes.toString("utf8");
    if (!Buffer.from(source, "utf8").equals(bytes)) {
      throw new Error(`Profile schema is not UTF-8: ${profile.schema}`);
    }
    let input;
    try { input = JSON.parse(source); }
    catch { throw new Error(`Profile schema is not valid JSON: ${profile.schema}`); }
    const definition = parseDirectoryProfileDefinition(input);
    if (definition.id.startsWith("site.") ||
        definition.fields.some(({ key }) => key.startsWith("site."))) {
      throw new Error(`Add-on profiles cannot claim the reserved site namespace: ${profile.schema}`);
    }
    if (definition.id !== profile.id || definition.version !== profile.version) {
      throw new Error(`Profile identity or version does not match the manifest: ${profile.schema}`);
    }
    return { ...profile, digest: profileDigest(definition) };
  });
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
  validateThemeModules(manifest, files);
  const profiles = validateProfileDefinitions(manifest, files);
  return { manifest, files, profiles, manifestBytes: canonicalJson(manifest), root };
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
