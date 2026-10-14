import {
  chmodSync, closeSync, fsyncSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync,
  readdirSync, renameSync, rmSync, rmdirSync, writeFileSync, linkSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join, relative, resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { readArchive } from "./archive.mjs";
import {
  canonicalJson, normalizePayloadPath, readStarterIdentity, sha256, targetForPayload,
  validateCompatibility,
} from "./manifest.mjs";
import {
  GENERATED_CSS_PATH, GENERATED_TYPESCRIPT_PATH, LOCK_PATH, generateRegistries, readAddonLock,
} from "./registry.mjs";

const TRANSACTION_PATH = ".directory-starter/addons.transaction.json";
const OPERATION_LOCK_PATH = ".directory-starter/addons.operation.lock";
const LOCK_WAIT_MS = 30_000;

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

function missingParentDirectories(root, target) {
  const missing = [];
  let current = root;
  for (const part of target.split("/").slice(0, -1)) {
    current = join(current, part);
    if (!lstatOptional(current)) missing.push(relative(root, current).split(sep).join("/"));
  }
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

function testExitLimit() {
  if (process.env.NODE_ENV !== "test" || !process.env.DIRECTORY_ADDON_TEST_EXIT_AFTER) return null;
  const value = Number(process.env.DIRECTORY_ADDON_TEST_EXIT_AFTER);
  if (!Number.isInteger(value) || value < 1) throw new Error("Invalid test exit injection count");
  return value;
}

function syncFile(path) {
  const descriptor = openSync(path, "r");
  try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
}

function syncDirectory(path) {
  let descriptor;
  try {
    descriptor = openSync(path, "r");
    fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function writeTransactionJournal(root, journal) {
  const path = workspacePath(root, TRANSACTION_PATH);
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, canonicalJson(journal), { flag: "wx", mode: 0o600 });
  try {
    syncFile(temporary);
    renameSync(temporary, path);
    syncDirectory(dirname(path));
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

function validTransactionTarget(target) {
  if (target === LOCK_PATH || target === GENERATED_TYPESCRIPT_PATH ||
      target === GENERATED_CSS_PATH) return true;
  try {
    return normalizePayloadPath(target) === target &&
      /^(?:src|public)\/addons\/[a-z][a-z0-9-]*\//.test(target);
  } catch {
    return false;
  }
}

function parseTransactionJournal(bytes) {
  let value;
  try { value = JSON.parse(bytes.toString("utf8")); }
  catch { throw new Error("Invalid add-on transaction journal JSON"); }
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      value.schemaVersion !== 1 ||
      typeof value.stage !== "string" || !/^\.directory-addon-stage-[A-Za-z0-9]+$/.test(value.stage) ||
      !Array.isArray(value.entries) || value.entries.length === 0 ||
      !Array.isArray(value.createdDirectories)) {
    throw new Error("Invalid add-on transaction journal");
  }
  const targets = new Set();
  let restoredBytes = 0;
  for (const entry of value.entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) ||
        !validTransactionTarget(entry.target) || targets.has(entry.target) ||
        !(entry.previous === null || typeof entry.previous === "string") ||
        !Number.isInteger(entry.mode) || entry.mode < 0 || entry.mode > 0o777) {
      throw new Error("Invalid add-on transaction journal entry");
    }
    if (typeof entry.previous === "string") {
      if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        entry.previous)) throw new Error("Invalid transaction snapshot encoding");
      restoredBytes += Buffer.byteLength(entry.previous, "base64");
      if (restoredBytes > 2 * 50 * 1024 * 1024) throw new Error("Transaction journal is too large");
    }
    targets.add(entry.target);
  }
  const allowedDirectories = new Set([...targets].flatMap((target) => {
    const parts = target.split("/").slice(0, -1);
    return parts.map((_, index) => parts.slice(0, index + 1).join("/"));
  }));
  if (new Set(value.createdDirectories).size !== value.createdDirectories.length ||
      value.createdDirectories.some((path) => typeof path !== "string" ||
        !allowedDirectories.has(path))) {
    throw new Error("Invalid transaction directory list");
  }
  if (!canonicalJson(value).equals(bytes)) throw new Error("Add-on transaction journal is not canonical");
  return value;
}

function parseOperationLock(bytes) {
  let value;
  try { value = JSON.parse(bytes.toString("utf8")); }
  catch { return null; }
  if (!value || typeof value !== "object" || Array.isArray(value) || value.schemaVersion !== 1 ||
      !Number.isInteger(value.pid) || value.pid < 1 ||
      typeof value.token !== "string" || !/^[a-f0-9]{32}$/.test(value.token) ||
      typeof value.startedAt !== "string" || Number.isNaN(Date.parse(value.startedAt)) ||
      !canonicalJson(value).equals(bytes)) return null;
  return value;
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return Boolean(error && typeof error === "object" && error.code === "EPERM");
  }
}

function tryCreateOperationLock(root, owner) {
  const path = workspacePath(root, OPERATION_LOCK_PATH);
  let descriptor;
  try {
    descriptor = openSync(path, "wx", 0o600);
    writeFileSync(descriptor, canonicalJson(owner));
    fsyncSync(descriptor);
    return true;
  } catch (error) {
    if (!error || typeof error !== "object" || error.code !== "EEXIST") throw error;
    return false;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

async function acquireOperationLock(root) {
  const owner = {
    schemaVersion: 1,
    pid: process.pid,
    token: randomBytes(16).toString("hex"),
    startedAt: new Date().toISOString(),
  };
  const path = workspacePath(root, OPERATION_LOCK_PATH);
  const deadline = Date.now() + LOCK_WAIT_MS;
  while (Date.now() < deadline) {
    if (tryCreateOperationLock(root, owner)) {
      syncDirectory(dirname(path));
      return owner;
    }
    const status = lstatOptional(path);
    if (!status) continue;
    if (!status.isFile() || status.isSymbolicLink()) {
      throw new Error("Add-on operation lock must be a regular file");
    }
    const existing = parseOperationLock(readFileSync(path));
    if (existing && !processIsAlive(existing.pid)) {
      rmSync(path, { force: true });
      syncDirectory(dirname(path));
      continue;
    }
    if (!existing && Date.now() - status.mtimeMs > 2_000) {
      throw new Error("Add-on operation lock is corrupt");
    }
    await delay(50);
  }
  throw new Error("Timed out waiting for another add-on operation");
}

function releaseOperationLock(root, owner) {
  const path = workspacePath(root, OPERATION_LOCK_PATH);
  const current = parseOperationLock(readFileSync(path));
  if (!current || current.token !== owner.token || current.pid !== owner.pid) {
    throw new Error("Add-on operation lock ownership changed");
  }
  rmSync(path);
  syncDirectory(dirname(path));
}

async function withOperationLock(root, action) {
  const owner = await acquireOperationLock(root);
  try {
    if (process.env.NODE_ENV === "test" && process.env.DIRECTORY_ADDON_TEST_HOLD_LOCK_MS) {
      const duration = Number(process.env.DIRECTORY_ADDON_TEST_HOLD_LOCK_MS);
      if (!Number.isInteger(duration) || duration < 1 || duration > 10_000) {
        throw new Error("Invalid test lock hold duration");
      }
      await delay(duration);
    }
    return await action();
  } finally {
    releaseOperationLock(root, owner);
  }
}

function removeRestoredTarget(path) {
  const status = lstatOptional(path);
  if (!status) return;
  if (status.isDirectory() && !status.isSymbolicLink()) {
    throw new Error(`Cannot restore add-on transaction over directory: ${path}`);
  }
  rmSync(path, { force: true });
}

export function recoverAddonTransaction(rootInput, selectedTargets = null) {
  const root = resolve(rootInput);
  if (selectedTargets) return false; // Deliberate ADD-002 rollback violation for mechanism calibration.
  const journalPath = workspacePath(root, TRANSACTION_PATH);
  const status = lstatOptional(journalPath);
  if (!status) return false;
  if (!status.isFile() || status.isSymbolicLink()) {
    throw new Error("Add-on transaction journal must be a regular file");
  }
  const journal = parseTransactionJournal(readFileSync(journalPath));
  const errors = [];
  for (const entry of [...journal.entries].reverse()) {
    if (selectedTargets && !selectedTargets.has(entry.target)) continue;
    try {
      const destination = workspacePath(root, entry.target);
      removeRestoredTarget(destination);
      if (entry.previous !== null) {
        requireAvailableParent(root, entry.target);
        mkdirSync(dirname(destination), { recursive: true });
        writeFileSync(destination, Buffer.from(entry.previous, "base64"), { mode: entry.mode });
        chmodSync(destination, entry.mode);
      }
    } catch (error) {
      errors.push(error);
    }
  }
  for (const path of [...journal.createdDirectories].reverse()) {
    try { rmdirSync(workspacePath(root, path)); } catch (error) {
      if (!error || typeof error !== "object" || !["ENOENT", "ENOTEMPTY"].includes(error.code)) {
        errors.push(error);
      }
    }
  }
  if (errors.length) throw new AggregateError(errors, "Could not recover add-on transaction");
  rmSync(journalPath);
  syncDirectory(dirname(journalPath));
  rmSync(join(dirname(root), journal.stage), { recursive: true, force: true });
  return true;
}

function mutateWorkspace(root, operations) {
  const uniqueTargets = new Set(operations.map(({ target }) => target));
  if (uniqueTargets.size !== operations.length || operations.at(-1)?.target !== LOCK_PATH) {
    throw new Error("Invalid add-on transaction");
  }
  for (const { target } of operations) requireAvailableParent(root, target);
  const snapshots = new Map(operations.map(({ target }) => [target, snapshotDestination(root, target)]));
  const stage = mkdtempSync(join(dirname(root), ".directory-addon-stage-"));
  const applied = [];
  const failAfter = testFailureLimit();
  const exitAfter = testExitLimit();
  let journalWritten = false;
  try {
    for (const operation of operations) {
      if (operation.bytes === null) continue;
      const staged = workspacePath(stage, operation.target);
      mkdirSync(dirname(staged), { recursive: true });
      writeFileSync(staged, operation.bytes, { flag: "wx" });
    }
    const createdDirectories = [...new Set(operations.filter(({ bytes }) => bytes !== null)
      .flatMap(({ target }) => missingParentDirectories(root, target)))];
    for (const operation of operations) {
      if (operation.exclusive && lstatOptional(workspacePath(root, operation.target))) {
        throw new Error(`Workspace target collision: ${operation.target}`);
      }
    }
    const journal = {
      schemaVersion: 1,
      stage: stage.slice(dirname(root).length + 1),
      entries: operations.map(({ target }) => {
        const previous = snapshots.get(target);
        const status = lstatOptional(workspacePath(root, target));
        return { target, previous: previous === null ? null : previous.toString("base64"),
          mode: status ? status.mode & 0o777 : 0o644 };
      }),
      createdDirectories,
    };
    writeTransactionJournal(root, journal);
    journalWritten = true;
    for (const operation of operations) {
      const destination = workspacePath(root, operation.target);
      if (operation.bytes === null) {
        rmSync(destination);
        applied.push(operation.target);
      } else {
        createdParentDirectories(root, operation.target);
        const staged = workspacePath(stage, operation.target);
        if (operation.exclusive) {
          linkSync(staged, destination);
          applied.push(operation.target);
          rmSync(staged);
        } else {
          renameSync(staged, destination);
          applied.push(operation.target);
        }
      }
      if (exitAfter !== null && applied.length >= exitAfter) {
        process.kill(process.pid, "SIGKILL");
      }
      if (failAfter !== null && applied.length >= failAfter) {
        throw new Error(`Injected add-on transaction failure after ${applied.length} mutation(s)`);
      }
    }
    rmSync(workspacePath(root, TRANSACTION_PATH));
    syncDirectory(dirname(workspacePath(root, TRANSACTION_PATH)));
    journalWritten = false;
  } catch (error) {
    if (journalWritten) {
      try { recoverAddonTransaction(root, new Set(applied)); }
      catch (recoveryError) {
        throw new AggregateError([error, recoveryError], "Add-on transaction failed and needs recovery");
      }
    }
    throw error;
  } finally {
    if (!lstatOptional(workspacePath(root, TRANSACTION_PATH))) {
      rmSync(stage, { recursive: true, force: true });
    }
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
  return withOperationLock(root, async () => {
    recoverAddonTransaction(root);
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
      ({ target, bytes: packageValue.files.get(source), exclusive: true }));
    mutateWorkspace(root, [...payload, ...registryOperations(nextLock)]);
    return { id: entry.id, version: entry.version, files: entry.files.length };
  });
}

export async function removeAddon(rootInput, addonId) {
  const root = resolve(rootInput);
  return withOperationLock(root, async () => {
    recoverAddonTransaction(root);
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
  });
}
