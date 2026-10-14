import {
  lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync,
  rmdirSync, writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { readArchive } from "./archive.mjs";
import {
  canonicalJson, readStarterIdentity, sha256, targetForPayload, validateCompatibility,
} from "./manifest.mjs";
import {
  GENERATED_CSS_PATH, GENERATED_TYPESCRIPT_PATH, LOCK_PATH, generateRegistries, readAddonLock,
} from "./registry.mjs";

function workspacePath(root, path) {
  return join(root, ...path.split("/"));
}

function lstatOptional(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return null;
    throw error;
  }
}

function requireOwnedFile(root, file) {
  const path = workspacePath(root, file.target);
  let status;
  try {
    status = lstatSync(path);
  } catch {
    throw new Error(`Installed add-on file is missing: ${file.target}`);
  }
  if (!status.isFile() || status.isSymbolicLink()) {
    throw new Error(`Installed add-on target is not a regular file: ${file.target}`);
  }
  const bytes = readFileSync(path);
  if (bytes.length !== file.bytes || sha256(bytes) !== file.sha256) {
    throw new Error(`Installed add-on file has changed: ${file.target}`);
  }
}

function requireGeneratedFile(root, path, expected) {
  const absolute = workspacePath(root, path);
  let status;
  try {
    status = lstatSync(absolute);
  } catch {
    throw new Error(`Generated add-on registry is missing: ${path}`);
  }
  if (!status.isFile() || status.isSymbolicLink() || !readFileSync(absolute).equals(expected)) {
    throw new Error(`Generated add-on registry has changed: ${path}`);
  }
}

function readBuiltInIds(root) {
  const themes = new Set(["preset"]);
  const themeDirectory = join(root, "src/themes");
  for (const entry of readdirSync(themeDirectory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".ts") || entry.name === "index.ts") continue;
    const match = /\bid:\s*["']([a-z][a-z0-9-]*)["']/.exec(
      readFileSync(join(themeDirectory, entry.name), "utf8"));
    if (!match) throw new Error(`Could not read built-in theme ID from src/themes/${entry.name}`);
    themes.add(match[1]);
  }
  const selection = readFileSync(join(root, "src/lib/theme-selection.ts"), "utf8");
  const options = /export const templateOptions\s*=\s*\[([\s\S]*?)\]\s*as const;/.exec(selection);
  if (!options) throw new Error("Could not read built-in template IDs");
  const templates = new Set([...options[1].matchAll(/\bid:\s*["']([a-z][a-z0-9-]*)["']/g)]
    .map((match) => match[1]));
  if (templates.size === 0) throw new Error("No built-in template IDs were found");
  return { themes, templates };
}

function verifyWorkspace(root, lock) {
  const expected = generateRegistries(lock);
  requireGeneratedFile(root, GENERATED_TYPESCRIPT_PATH, Buffer.from(expected.typescript));
  requireGeneratedFile(root, GENERATED_CSS_PATH, Buffer.from(expected.css));
  for (const addon of lock.addons) {
    for (const file of addon.files) requireOwnedFile(root, file);
  }
  return readBuiltInIds(root);
}

function requireAvailableParent(root, target) {
  const parts = target.split("/").slice(0, -1);
  let current = root;
  for (const part of parts) {
    current = join(current, part);
    const status = lstatOptional(current);
    if (!status) continue;
    if (!status.isDirectory() || status.isSymbolicLink()) {
      throw new Error(`Unsafe workspace parent for ${target}`);
    }
  }
}

function createdParentDirectories(root, target) {
  const missing = [];
  let current = root;
  for (const part of target.split("/").slice(0, -1)) {
    current = join(current, part);
    if (!lstatOptional(current)) missing.push(current);
  }
  mkdirSync(dirname(workspacePath(root, target)), { recursive: true });
  return missing;
}

function snapshotDestination(root, target) {
  const path = workspacePath(root, target);
  const status = lstatOptional(path);
  if (!status) return null;
  if (!status.isFile() || status.isSymbolicLink()) {
    throw new Error(`Mutation target is not a regular file: ${target}`);
  }
  return readFileSync(path);
}

function testFailureLimit() {
  if (process.env.NODE_ENV !== "test" || !process.env.DIRECTORY_ADDON_TEST_FAIL_AFTER) return null;
  const value = Number(process.env.DIRECTORY_ADDON_TEST_FAIL_AFTER);
  if (!Number.isInteger(value) || value < 1) throw new Error("Invalid test failure injection count");
  return value;
}

function mutateWorkspace(root, operations) {
  const uniqueTargets = new Set(operations.map(({ target }) => target));
  if (uniqueTargets.size !== operations.length || operations.at(-1)?.target !== LOCK_PATH) {
    throw new Error("Invalid add-on transaction");
  }
  for (const { target } of operations) requireAvailableParent(root, target);
  const snapshots = new Map(operations.map(({ target }) => [target, snapshotDestination(root, target)]));
  const stage = mkdtempSync(join(dirname(root), ".directory-addon-stage-"));
  const createdDirectories = [];
  const applied = [];
  const failAfter = testFailureLimit();
  try {
    for (const operation of operations) {
      if (operation.bytes === null) continue;
      const staged = workspacePath(stage, operation.target);
      mkdirSync(dirname(staged), { recursive: true });
      writeFileSync(staged, operation.bytes, { flag: "wx" });
    }
    for (const operation of operations) {
      const destination = workspacePath(root, operation.target);
      if (operation.bytes === null) {
        rmSync(destination);
      } else {
        createdDirectories.push(...createdParentDirectories(root, operation.target));
        renameSync(workspacePath(stage, operation.target), destination);
      }
      applied.push(operation.target);
      if (failAfter !== null && applied.length >= failAfter) {
        throw new Error(`Injected add-on transaction failure after ${applied.length} mutation(s)`);
      }
    }
  } catch (error) {
    for (const target of [...applied].reverse()) {
      const destination = workspacePath(root, target);
      const previous = snapshots.get(target);
      if (previous === null) rmSync(destination, { force: true });
      else {
        mkdirSync(dirname(destination), { recursive: true });
        writeFileSync(destination, previous);
      }
    }
    for (const directory of [...new Set(createdDirectories)].reverse()) {
      try { rmdirSync(directory); } catch { /* A pre-existing or non-empty directory stays. */ }
    }
    throw error;
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

function lockEntry(packageValue) {
  const { manifest, files, manifestBytes, archiveSha256 } = packageValue;
  return {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    archiveSha256,
    manifestSha256: sha256(manifestBytes),
    themes: manifest.themes,
    templates: manifest.templates,
    ...(manifest.seed ? { seed: manifest.seed } : {}),
    files: manifest.files.map((source) => {
      const bytes = files.get(source);
      return {
        source,
        target: targetForPayload(manifest.id, source),
        bytes: bytes.length,
        sha256: sha256(bytes),
      };
    }),
  };
}

function sortedLock(addons) {
  return { schemaVersion: 1, addons: [...addons].sort((left, right) => left.id.localeCompare(right.id)) };
}

function registryOperations(lock) {
  const registries = generateRegistries(lock);
  return [
    { target: GENERATED_TYPESCRIPT_PATH, bytes: Buffer.from(registries.typescript) },
    { target: GENERATED_CSS_PATH, bytes: Buffer.from(registries.css) },
    { target: LOCK_PATH, bytes: canonicalJson(lock) },
  ];
}

export async function installAddon(rootInput, archiveInput) {
  const root = resolve(rootInput);
  const starter = readStarterIdentity(root);
  const packageValue = await readArchive(archiveInput);
  validateCompatibility(packageValue.manifest, starter);
  const lock = readAddonLock(root);
  const builtIns = verifyWorkspace(root, lock);
  const manifest = packageValue.manifest;
  if (lock.addons.some(({ id }) => id === manifest.id)) {
    throw new Error(`Add-on is already installed: ${manifest.id}`);
  }
  const installedThemes = new Set(lock.addons.flatMap(({ themes }) => themes.map(({ id }) => id)));
  const installedTemplates = new Set(lock.addons.flatMap(({ templates }) => templates.map(({ id }) => id)));
  for (const { id } of manifest.themes) {
    if (builtIns.themes.has(id) || installedThemes.has(id)) throw new Error(`Theme ID collision: ${id}`);
  }
  for (const { id } of manifest.templates) {
    if (builtIns.templates.has(id) || installedTemplates.has(id)) {
      throw new Error(`Template ID collision: ${id}`);
    }
  }

  const entry = lockEntry(packageValue);
  const ownedTargets = new Set(lock.addons.flatMap(({ files }) => files.map(({ target }) => target)));
  for (const file of entry.files) {
    requireAvailableParent(root, file.target);
    if (ownedTargets.has(file.target) || lstatOptional(workspacePath(root, file.target))) {
      throw new Error(`Workspace target collision: ${file.target}`);
    }
  }
  const nextLock = sortedLock([...lock.addons, entry]);
  const payload = entry.files.map(({ source, target }) =>
    ({ target, bytes: packageValue.files.get(source) }));
  mutateWorkspace(root, [...payload, ...registryOperations(nextLock)]);
  return { id: entry.id, version: entry.version, files: entry.files.length };
}

export function removeAddon(rootInput, addonId) {
  const root = resolve(rootInput);
  readStarterIdentity(root);
  const lock = readAddonLock(root);
  verifyWorkspace(root, lock);
  const entry = lock.addons.find(({ id }) => id === addonId);
  if (!entry) throw new Error(`Add-on is not installed: ${addonId}`);
  const nextLock = sortedLock(lock.addons.filter(({ id }) => id !== addonId));
  const removals = entry.files.map(({ target }) => ({ target, bytes: null }));
  mutateWorkspace(root, [...removals, ...registryOperations(nextLock)]);
  for (const { target } of [...entry.files].reverse()) {
    let directory = dirname(workspacePath(root, target));
    while (directory !== root && relative(root, directory).split(sep)[0] !== "..") {
      try { rmdirSync(directory); } catch { break; }
      directory = dirname(directory);
    }
  }
  return { id: entry.id, version: entry.version, files: entry.files.length };
}
