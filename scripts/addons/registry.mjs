import { lstatSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import semver from "semver";
import { z } from "zod";
import { canonicalJson, normalizePayloadPath, targetForPayload } from "./manifest.mjs";

export const LOCK_PATH = ".directory-starter/addons.lock.json";
export const GENERATED_TYPESCRIPT_PATH = "src/addons/generated.ts";
export const GENERATED_CSS_PATH = "src/addons/generated.css";

const id = z.string().regex(/^[a-z][a-z0-9-]*$/);
const profileId = z.string().regex(/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/);
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
  renderer: sourcePath.optional(),
  templateApi: z.literal(1).optional(),
  stylesheet: sourcePath,
  supportedProfiles: z.array(z.object({
    id: profileId,
    range: z.string().refine((value) => semver.validRange(value) !== null),
  }).strict()).max(40).optional(),
}).strict();

const lockProfileSchema = z.object({
  id: profileId,
  version: z.string().refine((value) => semver.valid(value) !== null),
  schema: sourcePath,
  digest,
}).strict();

const lockAddonSchema = z.object({
  id,
  name: z.string().trim().min(1).max(120),
  version: z.string().min(1).max(80),
  archiveSha256: digest,
  manifestSha256: digest,
  themes: z.array(lockThemeSchema).max(40),
  templates: z.array(lockTemplateSchema).max(40),
  profiles: z.array(lockProfileSchema).max(40).optional(),
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
  unique(lock.addons.flatMap(({ profiles = [] }) => profiles.map(({ id: installedProfileId }) =>
    installedProfileId)), "installed profile ID");
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
        addon.templates.some(({ renderer }) => renderer && !sources.has(renderer)) ||
        (addon.profiles ?? []).some(({ schema }) => !sources.has(schema)) ||
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

function relativeSourcePath(addonId, source, extension, label, stripExtension = false) {
  const target = targetForPayload(addonId, source);
  const prefix = "src/addons/";
  if (!target.startsWith(prefix) || !target.endsWith(extension)) {
    throw new Error(`Invalid ${label} target: ${target}`);
  }
  const end = stripExtension ? -extension.length : undefined;
  return `./${target.slice(prefix.length, end)}`;
}

function registryContributions(lock) {
  const addons = [...lock.addons].sort((left, right) => left.id.localeCompare(right.id));
  const themes = addons.flatMap((addon) => addon.themes.map((theme) => ({ addon, theme })))
    .sort((left, right) => left.theme.id.localeCompare(right.theme.id));
  const templates = addons.flatMap((addon) =>
    addon.templates.map((template) => ({ addon, template })))
    .sort((left, right) => left.template.id.localeCompare(right.template.id));
  const profiles = addons.flatMap((addon) =>
    (addon.profiles ?? []).map((profile) => ({ addon, profile })))
    .sort((left, right) => left.profile.id.localeCompare(right.profile.id));
  return { themes, templates, profiles,
    rendererTemplates: templates.filter(({ template }) => template.renderer) };
}

function generatedTypescript({ themes, templates, profiles, rendererTemplates }) {
  const themeImports = themes.map(({ addon, theme }, index) =>
    `import addonThemeSource${index} from ${JSON.stringify(relativeSourcePath(addon.id,
      theme.entry, ".ts", "theme module", true))};`);
  const profileImports = profiles.map(({ addon, profile }, index) =>
    `import addonProfileSource${index} from ${JSON.stringify(relativeSourcePath(addon.id,
      profile.schema, ".json", "profile schema"))};`);
  const rendererImports = rendererTemplates.map(({ addon, template }, index) =>
    `import addonTemplateSource${index} from ${JSON.stringify(relativeSourcePath(addon.id,
      template.renderer, ".tsx", "template renderer", true))};`);
  const authoritativeThemes = themes.map(({ theme }, index) =>
    `const addonTheme${index}: ThemeDefinition = { ...addonThemeSource${index}, id: ${JSON.stringify(
      theme.id)}, name: ${JSON.stringify(theme.name)} };`);
  return [
    'import type { ThemeDefinition } from "@/lib/theme-sdk";',
    'import type { DirectoryProfileDefinition } from "@/lib/directory-profile-types";',
    'import type { PublicTemplateDefinition } from "@/lib/public-template-sdk";',
    ...((themeImports.length || profileImports.length || rendererImports.length)
      ? ["", ...themeImports, ...profileImports, ...rendererImports] : []),
    ...(authoritativeThemes.length ? ["", ...authoritativeThemes] : []),
    "",
    `export const addonThemeDefinitions: ThemeDefinition[] = [${themes.map((_, index) =>
      `addonTheme${index}`).join(", ")}];`,
    templates.length
      ? `export const addonTemplateOptions = [${templates.map(({ template }) =>
        `{ id: ${JSON.stringify(template.id)}, name: ${JSON.stringify(template.name)}` +
          `, supportedProfiles: ${JSON.stringify(template.supportedProfiles)}` +
          " }").join(", ")}] as const;`
      : "export const addonTemplateOptions: readonly { id: string; name: string; " +
        "supportedProfiles?: readonly { id: string; range: string }[] }[] = [];",
    rendererTemplates.length
      ? `export const addonTemplateDefinitions: PublicTemplateDefinition[] = [${rendererTemplates.map(
        ({ template }, index) => `{ ...addonTemplateSource${index}, id: ${JSON.stringify(template.id)}, ` +
          `name: ${JSON.stringify(template.name)}, supportedProfiles: ${JSON.stringify(
            template.supportedProfiles)} }`).join(", ")}];`
      : "export const addonTemplateDefinitions: PublicTemplateDefinition[] = [];",
    profiles.length
      ? `export const addonProfileDefinitions = [${profiles.map((_, index) =>
        `addonProfileSource${index} as unknown as DirectoryProfileDefinition`).join(", ")}];`
      : "export const addonProfileDefinitions: readonly DirectoryProfileDefinition[] = [];",
    profiles.length
      ? `export const addonProfileMetadata = [${profiles.map(({ addon, profile }) =>
        `{ addonId: ${JSON.stringify(addon.id)}, profileId: ${JSON.stringify(profile.id)}, ` +
        `version: ${JSON.stringify(profile.version)}, digest: ${JSON.stringify(profile.digest)}, ` +
        `schema: ${JSON.stringify(profile.schema)} }`).join(", ")}] as const;`
      : "export const addonProfileMetadata: readonly { addonId: string; profileId: string; " +
        "version: string; digest: string; schema: string }[] = [];",
    "",
  ].join("\n");
}

export function generateRegistries(lock) {
  const contributions = registryContributions(lock);
  const { templates } = contributions;
  const cssImports = templates.map(({ addon, template }) =>
    `@import ${JSON.stringify(relativeSourcePath(addon.id, template.stylesheet,
      ".css", "template stylesheet"))};`);
  const css = ["/* Generated by scripts/addons.mjs. */", ...cssImports, ""].join("\n");
  return { typescript: generatedTypescript(contributions), css };
}
