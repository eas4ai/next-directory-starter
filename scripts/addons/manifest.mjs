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
export const PUBLIC_TEMPLATE_API_VERSION = 1;
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
  renderer: payloadPath.optional(),
  templateApi: z.literal(PUBLIC_TEMPLATE_API_VERSION).optional(),
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

function validateRendererDeclaration(template, files) {
  if (!template.renderer) {
    if (template.templateApi !== undefined) {
      throw new Error(`Stylesheet-only template cannot declare templateApi: ${template.id}`);
    }
    return;
  }
  if (!template.renderer.startsWith("src/") || !template.renderer.endsWith(".tsx") ||
      !files.has(template.renderer)) {
    throw new Error(`Template renderer is not a declared TSX payload: ${template.renderer}`);
  }
  if (template.supportedProfiles.length === 0) {
    throw new Error(`Template renderer must declare a supported profile: ${template.id}`);
  }
  if (template.templateApi !== PUBLIC_TEMPLATE_API_VERSION) {
    throw new Error(`Template renderer must declare templateApi ${PUBLIC_TEMPLATE_API_VERSION}: ${template.id}`);
  }
}

function validateTemplateProfiles(template, profiles) {
  for (const supported of template.supportedProfiles) {
    const packaged = profiles.find(({ id }) => id === supported.id);
    if (template.renderer && !packaged) {
      throw new Error(`Template renderer profile is not packaged: ${supported.id}`);
    }
    if (packaged && !semver.satisfies(packaged.version, supported.range,
      { includePrerelease: true })) {
      throw new Error(`Template ${template.id} is incompatible with packaged profile ` +
        `${packaged.id}@${packaged.version}`);
    }
  }
}

function validateTemplateDeclaration(template, profiles, files) {
  if (!template.stylesheet.startsWith("src/") || !template.stylesheet.endsWith(".css") ||
      !files.has(template.stylesheet)) {
    throw new Error(`Template stylesheet is not a declared CSS payload: ${template.stylesheet}`);
  }
  unique(template.supportedProfiles.map(({ id }) => id),
    `supported profile ID for template ${template.id}`);
  validateRendererDeclaration(template, files);
  validateTemplateProfiles(template, profiles);
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
  if (path.startsWith("docs/")) return `src/addons/${addonId}/docs/${path.slice(5)}`;
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

function exportedObject(sourceFile, path, label) {
  const assignments = sourceFile.statements.filter((statement) =>
    ts.isExportAssignment(statement) && !statement.isExportEquals);
  if (assignments.length !== 1) throw new Error(`${label} must have one default export: ${path}`);
  let expression = unwrapExpression(assignments[0].expression);
  if (ts.isIdentifier(expression)) {
    const declaration = sourceFile.statements.filter(ts.isVariableStatement)
      .flatMap(({ declarationList }) => [...declarationList.declarations])
      .find((candidate) => ts.isIdentifier(candidate.name) && candidate.name.text === expression.text);
    if (!declaration?.initializer) throw new Error(`${label} default export is not defined: ${path}`);
    expression = unwrapExpression(declaration.initializer);
  }
  if (!ts.isObjectLiteralExpression(expression)) {
    throw new Error(`${label} default export must be an object literal: ${path}`);
  }
  if (expression.properties.some(ts.isSpreadAssignment)) {
    throw new Error(`${label} default export cannot contain spreads: ${path}`);
  }
  return expression;
}

function literalProperty(object, name, path, label) {
  const matches = object.properties.filter((property) => objectPropertyName(property) === name);
  if (matches.length !== 1 || !ts.isPropertyAssignment(matches[0])) {
    throw new Error(`${label} must declare one literal ${name}: ${path}`);
  }
  const expression = unwrapExpression(matches[0].initializer);
  if (!ts.isStringLiteral(expression) && !ts.isNoSubstitutionTemplateLiteral(expression)) {
    throw new Error(`${label} ${name} must be a string literal: ${path}`);
  }
  return expression.text;
}

function typescriptPayload(files, path, label, scriptKind) {
  const bytes = files.get(path);
  if (!bytes) throw new Error(`${label} is missing: ${path}`);
  const source = bytes.toString("utf8");
  if (!Buffer.from(source, "utf8").equals(bytes)) {
    throw new Error(`${label} is not UTF-8: ${path}`);
  }
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, scriptKind);
  if (sourceFile.parseDiagnostics.length > 0) {
    throw new Error(`${label} is not valid TypeScript: ${path}`);
  }
  return sourceFile;
}

export function validateThemeModules(manifest, files) {
  const required = new Set([
    "id", "name", "light", "dark", "typography", "radius", "shadow", "controlHeight",
    "spacing", "width", "social",
  ]);
  for (const theme of manifest.themes) {
    const sourceFile = typescriptPayload(files, theme.entry, "Theme entry", ts.ScriptKind.TS);
    const object = exportedObject(sourceFile, theme.entry, "Theme");
    const names = new Set(object.properties.map(objectPropertyName).filter(Boolean));
    if ([...required].some((name) => !names.has(name))) {
      throw new Error(`Theme entry is missing required fields: ${theme.entry}`);
    }
    if (literalProperty(object, "id", theme.entry, "Theme") !== theme.id ||
        literalProperty(object, "name", theme.entry, "Theme") !== theme.name) {
      throw new Error(`Theme identity does not match the manifest: ${theme.entry}`);
    }
  }
}

const rendererImports = new Set([
  "@/components/public-template-primitives",
  "@/lib/public-template-sdk",
]);
const forbiddenRendererGlobals = new Set([
  "__dirname", "__filename", "Buffer", "Bun", "Deno", "document", "eval", "exports",
  "fetch", "Function", "global", "globalThis", "localStorage", "module", "navigator",
  "Object", "process", "Proxy", "Reflect", "require", "sessionStorage", "WebAssembly",
  "WebSocket", "window", "Worker", "XMLHttpRequest",
]);
const forbiddenRendererProperties = new Set([
  "__proto__", "arguments", "callee", "caller", "constructor", "create", "defineProperties",
  "defineProperty", "getOwnPropertyDescriptor", "getOwnPropertyDescriptors", "getPrototypeOf",
  "prototype", "setPrototypeOf",
]);

const rendererNames = new Set([
  "header", "home", "directory", "card", "listing", "featured", "empty", "pagination",
  "comparison", "footer",
]);

function validateRendererStatements(sourceFile, path) {
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      const specifier = ts.isStringLiteral(statement.moduleSpecifier)
        ? statement.moduleSpecifier.text : "";
      if (!rendererImports.has(specifier)) {
        throw new Error(`Forbidden renderer import ${specifier || "<dynamic>"}: ${path}`);
      }
      continue;
    }
    if (ts.isVariableStatement(statement) || ts.isExportAssignment(statement) ||
        ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)) continue;
    throw new Error(`Forbidden renderer top-level statement: ${path}`);
  }
}

function isPropertyNameReference(node) {
  return (ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) ||
    (ts.isPropertyAssignment(node.parent) && node.parent.name === node &&
      node.parent.initializer !== node);
}

function rendererElementAccessName(node, path) {
  const argument = unwrapExpression(node.argumentExpression);
  if (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument) ||
      ts.isNumericLiteral(argument)) return argument.text;
  throw new Error(`Forbidden renderer computed property: ${path}`);
}

function rendererBindingName(node, path) {
  if (!node.propertyName) return null;
  if (ts.isIdentifier(node.propertyName) || ts.isStringLiteral(node.propertyName) ||
      ts.isNumericLiteral(node.propertyName)) return node.propertyName.text;
  if (ts.isComputedPropertyName(node.propertyName)) {
    const expression = unwrapExpression(node.propertyName.expression);
    if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression) ||
        ts.isNumericLiteral(expression)) return expression.text;
    throw new Error(`Forbidden renderer computed property: ${path}`);
  }
  return null;
}

function validateRendererNode(node, path) {
  if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(node.expression) && ["eval", "require", "Function"].includes(
        node.expression.text)))) {
    throw new Error(`Forbidden renderer dynamic code: ${path}`);
  }
  if (ts.isJsxAttribute(node) && node.name.text === "dangerouslySetInnerHTML") {
    throw new Error(`Forbidden renderer raw HTML: ${path}`);
  }
  if (ts.isMetaProperty(node)) {
    throw new Error(`Forbidden renderer module metadata: ${path}`);
  }
  const property = ts.isPropertyAccessExpression(node) ? node.name.text
    : ts.isElementAccessExpression(node) ? rendererElementAccessName(node, path)
      : ts.isBindingElement(node) ? rendererBindingName(node, path) : null;
  if (property && forbiddenRendererProperties.has(property)) {
    throw new Error(`Forbidden renderer dynamic code property ${property}: ${path}`);
  }
  if (ts.isIdentifier(node) && forbiddenRendererGlobals.has(node.text) &&
      !isPropertyNameReference(node)) {
    throw new Error(`Forbidden renderer global ${node.text}: ${path}`);
  }
  ts.forEachChild(node, (child) => validateRendererNode(child, path));
}

function rendererObject(sourceFile, path) {
  const object = exportedObject(sourceFile, path, "Renderer");
  const property = object.properties.find((candidate) => objectPropertyName(candidate) === "renderers");
  if (!property || !ts.isPropertyAssignment(property)) {
    throw new Error(`Renderer must declare one renderers object: ${path}`);
  }
  const value = unwrapExpression(property.initializer);
  if (!ts.isObjectLiteralExpression(value) || value.properties.length === 0 ||
      value.properties.some((candidate) => !ts.isMethodDeclaration(candidate) ||
        !rendererNames.has(objectPropertyName(candidate)))) {
    throw new Error(`Renderer must declare supported renderer methods: ${path}`);
  }
  unique(value.properties.map(objectPropertyName), `renderer surface in ${path}`);
  return object;
}

function validateRendererTypes(path, source) {
  const configPath = ts.findConfigFile(process.cwd(), ts.sys.fileExists);
  if (!configPath) throw new Error("Starter TypeScript configuration is missing");
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error) {
    throw new Error(`Starter TypeScript configuration is invalid: ${ts.flattenDiagnosticMessageText(
      config.error.messageText, " ")}`);
  }
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, process.cwd(), {
    incremental: false, noEmit: true,
  }, configPath);
  const virtualPath = resolve(".directory-template-validation", path);
  const host = ts.createCompilerHost(parsed.options);
  const originalFileExists = host.fileExists.bind(host);
  const originalReadFile = host.readFile.bind(host);
  host.fileExists = (candidate) => candidate === virtualPath || originalFileExists(candidate);
  host.readFile = (candidate) => candidate === virtualPath ? source : originalReadFile(candidate);
  const program = ts.createProgram([virtualPath], parsed.options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program).filter(({ category }) =>
    category === ts.DiagnosticCategory.Error);
  if (diagnostics.length > 0) {
    const detail = ts.flattenDiagnosticMessageText(diagnostics[0].messageText, " ");
    throw new Error(`Template renderer does not satisfy templateApi 1: ${path}: ${detail}`);
  }
}

export function validateRendererModules(manifest, files) {
  for (const template of manifest.templates) {
    if (!template.renderer) continue;
    const sourceFile = typescriptPayload(files, template.renderer, "Template renderer",
      ts.ScriptKind.TSX);
    validateRendererStatements(sourceFile, template.renderer);
    validateRendererNode(sourceFile, template.renderer);
    const object = rendererObject(sourceFile, template.renderer);
    const names = new Set(object.properties.map(objectPropertyName).filter(Boolean));
    if (!names.has("id") || !names.has("name") || !names.has("renderers")) {
      throw new Error(`Template renderer is missing required fields: ${template.renderer}`);
    }
    if (literalProperty(object, "id", template.renderer, "Renderer") !== template.id ||
        literalProperty(object, "name", template.renderer, "Renderer") !== template.name) {
      throw new Error(`Template renderer identity does not match the manifest: ${template.renderer}`);
    }
    validateRendererTypes(template.renderer, sourceFile.text);
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
  validateRendererModules(manifest, files);
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
