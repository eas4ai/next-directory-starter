import {
  closeSync, createWriteStream, fstatSync, openSync, readFileSync, renameSync, rmSync,
} from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { arrayBuffer } from "node:stream/consumers";
import { pipeline } from "node:stream/promises";
import yauzl from "yauzl";
import yazl from "yazl";
import {
  INTEGRITY_NAME, MANIFEST_NAME, MAX_ARCHIVE_BYTES, MAX_FILE_BYTES, MAX_FILES,
  MAX_PACKAGE_BYTES,
  canonicalJson, integritySchema, normalizePayloadPath, parseManifest, readSourcePackage, sha256,
  validateProfileDefinitions, validateRendererModules, validateThemeModules,
} from "./manifest.mjs";
import { validatePackagedSeedMedia } from "./seed-media.mjs";

const FIXED_TIME = new Date("1980-01-01T00:00:00.000Z");
const FILE_MODE = 0o100644;

function archiveEntryPath(value) {
  if (value === INTEGRITY_NAME) return value;
  return normalizePayloadPath(value);
}

function integrityFor(manifestBytes, files) {
  const entries = [[MANIFEST_NAME, manifestBytes], ...files.entries()]
    .sort(([left], [right]) => left.localeCompare(right));
  return {
    schemaVersion: 1,
    files: entries.map(([path, bytes]) => ({ path, bytes: bytes.length, sha256: sha256(bytes) })),
  };
}

async function writeZip(path, entries) {
  const zip = new yazl.ZipFile();
  for (const [name, bytes] of entries.sort(([left], [right]) => left.localeCompare(right))) {
    zip.addBuffer(bytes, name, {
      mtime: FIXED_TIME,
      mode: FILE_MODE,
      compress: true,
      compressionLevel: 9,
      forceDosTimestamp: true,
    });
  }
  const temporary = `${path}.${process.pid}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  try {
    const complete = pipeline(zip.outputStream, createWriteStream(temporary, { flags: "wx" }));
    zip.end();
    await complete;
    renameSync(temporary, path);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

export async function packAddon(source, output) {
  const value = await readSourcePackage(source);
  const integrityBytes = canonicalJson(integrityFor(value.manifestBytes, value.files));
  const entries = [
    [MANIFEST_NAME, value.manifestBytes],
    ...value.files.entries(),
    [INTEGRITY_NAME, integrityBytes],
  ];
  const path = resolve(output);
  await writeZip(path, entries);
  const bytes = await readFile(path);
  return { id: value.manifest.id, version: value.manifest.version, path, sha256: sha256(bytes) };
}

function entryMode(entry) {
  return (entry.externalFileAttributes >>> 16) & 0xffff;
}

function requireRegularEntry(entry) {
  if ((entry.generalPurposeBitFlag & 0x1) !== 0) throw new Error("Encrypted ZIP entries are not allowed");
  if (entry.fileName.endsWith("/")) throw new Error(`Directory ZIP entries are not allowed: ${entry.fileName}`);
  const mode = entryMode(entry);
  const type = mode & 0o170000;
  if (type !== 0 && type !== 0o100000) {
    throw new Error(`Non-file ZIP entry is not allowed: ${entry.fileName}`);
  }
  if (entry.uncompressedSize > MAX_FILE_BYTES) throw new Error(`ZIP entry is too large: ${entry.fileName}`);
}

async function archiveFiles(bytes) {
  const zip = await yauzl.fromBufferPromise(bytes, {
    autoClose: true,
    decodeStrings: true,
    strictFileNames: true,
    validateEntrySizes: true,
  });
  const files = new Map();
  let total = 0;
  try {
    for await (const entry of zip.eachEntry()) {
      requireRegularEntry(entry);
      const name = archiveEntryPath(entry.fileName);
      if (files.has(name)) throw new Error(`Duplicate ZIP entry: ${name}`);
      if (files.size >= MAX_FILES + 2) throw new Error("ZIP contains too many files");
      total += entry.uncompressedSize;
      if (total > MAX_PACKAGE_BYTES) throw new Error("ZIP payload is too large");
      const stream = await zip.openReadStreamPromise(entry);
      const bytes = Buffer.from(await arrayBuffer(stream));
      if (bytes.length !== entry.uncompressedSize) throw new Error(`ZIP size mismatch: ${name}`);
      files.set(name, bytes);
    }
  } finally {
    zip.close();
  }
  return files;
}

function readBoundedArchive(path) {
  const descriptor = openSync(path, "r");
  try {
    const before = fstatSync(descriptor);
    if (!before.isFile()) throw new Error("Add-on archive must be a regular file");
    if (before.size > MAX_ARCHIVE_BYTES) throw new Error("Add-on archive is too large");
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    if (bytes.length !== before.size || after.size !== before.size ||
        after.mtimeMs !== before.mtimeMs || after.ino !== before.ino || after.dev !== before.dev) {
      throw new Error("Add-on archive changed while it was being read");
    }
    return bytes;
  } finally {
    closeSync(descriptor);
  }
}

function parseJson(bytes, label) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`Invalid ${label} JSON`);
  }
}

export async function readArchive(input) {
  const path = resolve(input);
  const archiveBytes = readBoundedArchive(path);
  const entries = await archiveFiles(archiveBytes);
  const manifestBytes = entries.get(MANIFEST_NAME);
  const integrityBytes = entries.get(INTEGRITY_NAME);
  if (!manifestBytes || !integrityBytes) throw new Error("Archive is missing manifest or integrity metadata");
  const manifest = parseManifest(parseJson(manifestBytes, "manifest"));
  const integrity = integritySchema.parse(parseJson(integrityBytes, "integrity"));
  const expected = new Set([MANIFEST_NAME, INTEGRITY_NAME, ...manifest.files]);
  if (entries.size !== expected.size || [...entries.keys()].some((name) => !expected.has(name))) {
    throw new Error("Archive entries do not match the manifest");
  }
  const integrityPaths = integrity.files.map(({ path }) => archiveEntryPath(path));
  if (new Set(integrityPaths).size !== integrityPaths.length) throw new Error("Duplicate integrity path");
  const hashed = new Map(integrity.files.map((file) => [file.path, file]));
  const expectedHashed = [MANIFEST_NAME, ...manifest.files];
  if (hashed.size !== expectedHashed.length || expectedHashed.some((name) => !hashed.has(name))) {
    throw new Error("Integrity entries do not match the manifest");
  }
  for (const name of expectedHashed) {
    const bytes = entries.get(name);
    const record = hashed.get(name);
    if (bytes.length !== record.bytes || sha256(bytes) !== record.sha256) {
      throw new Error(`Archive integrity mismatch: ${name}`);
    }
  }
  const files = new Map(manifest.files.map((name) => [name, entries.get(name)]));
  validateThemeModules(manifest, files);
  validateRendererModules(manifest, files);
  const profiles = validateProfileDefinitions(manifest, files);
  await validatePackagedSeedMedia(manifest, files);
  return {
    manifest,
    files,
    profiles,
    manifestBytes,
    archiveSha256: sha256(archiveBytes),
    path,
  };
}
