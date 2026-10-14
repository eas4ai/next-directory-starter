import { lstatSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import { canonicalJson, normalizePayloadPath, targetForPayload } from "./manifest.mjs";

export const LOCK_PATH = ".directory-starter/addons.lock.json";
export const GENERATED_TYPESCRIPT_PATH = "src/addons/generated.ts";
export const GENERATED_CSS_PATH = "src/addons/generated.css";

const id = z.string().regex(/^[a-z][a-z0-9-]*$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const sourcePath = z.string().superRefine((value, context) => {
  try {
    normalizePayloadPath(value);
  } catch (error) {
    context.addIssue({ code: "custom", message: error.message });
  }
});
const targetPath = z.string().superRefine((value, context) => {
  try {
    normalizePayloadPath(value);
  } catch (error) {
    context.addIssue({ code: "custom", message: error.message });
  }
});

const lockFileSchema = z.object({
  source: sourcePath,
  target: targetPath,
  bytes: z.number().int().min(0),
  sha256: digest,
}).strict();

const lockThemeSchema = z.object({
  id,
  name: z.string().trim().min(1).max(120),
  entry: sourcePath,
}).strict();

const lockTemplateSchema = z.object({
  id,
  name: z.string().trim().min(1).max(120),
  stylesheet: sourcePath,
}).strict();

const lockAddonSchema = z.object({
  id,
  name: z.string().trim().min(1).max(120),
  version: z.string().min(1).max(80),
  archiveSha256: digest,
  manifestSha256: digest,
  themes: z.array(lockThemeSchema).max(40),
  templates: z.array(lockTemplateSchema).max(40),
  seed: sourcePath.optional(),
  files: z.array(lockFileSchema).min(1),
}).strict();

const addonLockSchema = z.object({
  schemaVersion: z.literal(1),
  addons: z.array(lockAddonSchema),
}).strict().superRefine((lock, context) => {
  const unique = (values, label) => {
    if (new Set(values).size !== values.length) {
      context.addIssue({ code: "custom", message: `Duplicate ${label}` });
    }
  };
  unique(lock.addons.map(({ id: addonId }) => addonId), "installed add-on ID");
  unique(lock.addons.flatMap(({ themes }) => themes.map(({ id: themeId }) => themeId)),
    "installed theme ID");
  unique(lock.addons.flatMap(({ templates }) => templates.map(({ id: templateId }) => templateId)),
    "installed template ID");
  unique(lock.addons.flatMap(({ files }) => files.map(({ target }) => target)),
    "owned target");
  for (const addon of lock.addons) {
    const sources = new Set(addon.files.map(({ source }) => source));
    const expectedTargets = addon.files.map(({ source }) => targetForPayload(addon.id, source));
    if (addon.files.some(({ source, target }) => targetForPayload(addon.id, source) !== target)) {
      context.addIssue({ code: "custom", message: `Invalid owned target for ${addon.id}` });
    }
    if (new Set(expectedTargets).size !== expectedTargets.length ||
        addon.themes.some(({ entry }) => !sources.has(entry)) ||
        addon.templates.some(({ stylesheet }) => !sources.has(stylesheet)) ||
        (addon.seed && !sources.has(addon.seed))) {
      context.addIssue({ code: "custom", message: `Invalid contributions for ${addon.id}` });
    }
  }
});

function parseJson(bytes, label) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`Invalid ${label} JSON`);
  }
}

export function readAddonLock(root = process.cwd()) {
  const path = join(resolve(root), LOCK_PATH);
  let status;
  try {
    status = lstatSync(path);
  } catch {
    throw new Error(`Missing add-on lock: ${LOCK_PATH}`);
  }
  if (!status.isFile() || status.isSymbolicLink()) throw new Error("Add-on lock must be a regular file");
  const bytes = readFileSync(path);
  const lock = addonLockSchema.parse(parseJson(bytes, "add-on lock"));
  if (!canonicalJson(lock).equals(bytes)) throw new Error("Add-on lock is not canonical");
  return lock;
}

function relativeModulePath(addonId, source) {
  const target = targetForPayload(addonId, source);
  const prefix = "src/addons/";
  if (!target.startsWith(prefix) || !target.endsWith(".ts")) {
    throw new Error(`Invalid theme module target: ${target}`);
  }
  return `./${target.slice(prefix.length, -3)}`;
}

function relativeStylesheetPath(addonId, source) {
  const target = targetForPayload(addonId, source);
  const prefix = "src/addons/";
  if (!target.startsWith(prefix) || !target.endsWith(".css")) {
    throw new Error(`Invalid template stylesheet target: ${target}`);
  }
  return `./${target.slice(prefix.length)}`;
}

export function generateRegistries(lock) {
  const addons = [...lock.addons].sort((left, right) => left.id.localeCompare(right.id));
  const themes = addons.flatMap((addon) => addon.themes.map((theme) => ({ addon, theme })))
    .sort((left, right) => left.theme.id.localeCompare(right.theme.id));
  const templates = addons.flatMap((addon) =>
    addon.templates.map((template) => ({ addon, template })))
    .sort((left, right) => left.template.id.localeCompare(right.template.id));

  const imports = themes.map(({ addon, theme }, index) =>
    `import addonThemeSource${index} from ${JSON.stringify(relativeModulePath(addon.id, theme.entry))};`);
  const authoritativeThemes = themes.map(({ theme }, index) =>
    `const addonTheme${index}: ThemeDefinition = { ...addonThemeSource${index}, id: ${JSON.stringify(
      theme.id)}, name: ${JSON.stringify(theme.name)} };`);
  const typescript = [
    'import type { ThemeDefinition } from "@/lib/theme-sdk";',
    ...(imports.length ? ["", ...imports] : []),
    ...(authoritativeThemes.length ? ["", ...authoritativeThemes] : []),
    "",
    `export const addonThemeDefinitions: ThemeDefinition[] = [${themes.map((_, index) =>
      `addonTheme${index}`).join(", ")}];`,
    templates.length
      ? `export const addonTemplateOptions = [${templates.map(({ template }) =>
        `{ id: ${JSON.stringify(template.id)}, name: ${JSON.stringify(template.name)} }`).join(", ")}] as const;`
      : "export const addonTemplateOptions: readonly { id: string; name: string }[] = [];",
    "",
  ].join("\n");

  const cssImports = templates.map(({ addon, template }) =>
    `@import ${JSON.stringify(relativeStylesheetPath(addon.id, template.stylesheet))};`);
  const css = ["/* Generated by scripts/addons.mjs. */", ...cssImports, ""].join("\n");
  return { typescript, css };
}
