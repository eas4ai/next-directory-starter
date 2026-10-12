import { createDecipheriv, createHash } from 'node:crypto';
import { createReadStream, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import Database from 'better-sqlite3';

export function databasePath() {
  const url = process.env.DATABASE_URL ?? 'file:./.runtime/directory.db';
  if (!url.startsWith('file:') || url.slice(5) === ':memory:') {
    throw new Error('DATABASE_URL must name a persistent file: SQLite database');
  }
  return resolve(url.slice(5));
}

export function mediaPath(databaseFile = databasePath()) {
  return resolve(process.env.MEDIA_DIR?.trim() || join(dirname(databaseFile), 'media'));
}

export function parsePairs(args, names) {
  const values = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!names.includes(args[i]) || !args[i + 1] || values[args[i]]) {
      throw new Error(`Expected ${names.join(' and ')}`);
    }
    values[args[i]] = resolve(args[i + 1]);
  }
  if (args.length !== names.length * 2 || names.some((name) => !values[name])) {
    throw new Error(`Expected ${names.join(' and ')}`);
  }
  return values;
}

export function contained(child, parent) {
  const path = relative(parent, child);
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !path.startsWith(sep));
}

export function pathEntryExists(path) {
  return lstatSync(path, { throwIfNoEntry: false }) !== undefined;
}

export function requireRegularFile(path, label) {
  if (!lstatSync(path, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`${label} must be a regular file`);
  }
}

export function requireRealDirectory(path, label) {
  if (!lstatSync(path, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`${label} must be a real directory`);
  }
}

export function canonicalPath(path) {
  let current = resolve(path);
  const missing = [];
  while (!pathEntryExists(current)) {
    const parent = dirname(current);
    if (parent === current) throw new Error('Cannot resolve storage path');
    missing.unshift(basename(current));
    current = parent;
  }
  return resolve(realpathSync(current), ...missing);
}

export function regularFiles(root) {
  requireRealDirectory(root, 'Media root');
  const files = [];
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.push(path);
      else throw new Error('Media contains a link or unsupported file');
    }
  }
  visit(root);
  return files.sort();
}

export async function hashFile(file) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest('hex');
}

export function readKey(file) {
  requireRegularFile(file, 'Billing key');
  const encoded = readFileSync(file, 'utf8').trim();
  if (!/^[A-Za-z0-9_-]{43}$/.test(encoded) ||
      Buffer.from(encoded, 'base64url').toString('base64url') !== encoded) {
    throw new Error('Billing key must be a 32-byte base64url value');
  }
  return encoded;
}

function inspectBrandAssets(db, mediaDirectory) {
  const brand = db.prepare("SELECT value FROM site_settings WHERE key = 'site_branding'").get();
  if (!brand) return;
  let settings;
  try { settings = JSON.parse(brand.value); }
  catch { throw new Error('Saved branding settings are invalid'); }
  for (const field of ['logoUrl', 'iconUrl', 'socialImage']) {
    const value = settings[field];
    if (typeof value !== 'string' || !value.startsWith('/brand-assets/')) continue;
    const id = /^\/brand-assets\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.webp$/.exec(value)?.[1];
    if (!id || !lstatSync(join(mediaDirectory, `${id}.webp`), { throwIfNoEntry: false })?.isFile()) {
      throw new Error('A current brand image is missing');
    }
  }
}

export function inspectDatabase(file, mediaDirectory, encodedKey) {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    if (db.pragma('integrity_check', { simple: true }) !== 'ok' ||
        db.pragma('foreign_key_check').length) throw new Error('Database integrity check failed');
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all().map((row) => row.name);
    if (tables.includes('media_assets')) {
      for (const { id } of db.prepare('SELECT id FROM media_assets').iterate()) {
        if (!/^[0-9a-f-]{36}$/.test(id) ||
            !lstatSync(join(mediaDirectory, `${id}.webp`)).isFile()) {
          throw new Error('An uploaded media file is missing');
        }
      }
    }
    if (tables.includes('site_settings')) inspectBrandAssets(db, mediaDirectory);
    if (tables.includes('billing_profiles')) {
      const key = Buffer.from(encodedKey, 'base64url');
      for (const row of db.prepare(`SELECT provider, mode, api_key_cipher, webhook_secret_cipher
        FROM billing_profiles`).iterate()) {
        for (const [column, field] of [['api_key_cipher', 'apiKey'],
          ['webhook_secret_cipher', 'webhookSecret']]) {
          if (!row[column]) continue;
          if (!row[column].startsWith('v1:')) throw new Error('Unknown billing secret format');
          const payload = Buffer.from(row[column].slice(3), 'base64url');
          if (payload.length < 29) throw new Error('Invalid billing secret');
          try {
            const decipher = createDecipheriv('aes-256-gcm', key, payload.subarray(0, 12));
            decipher.setAAD(Buffer.from(`${row.provider}:${row.mode}:${field}`));
            decipher.setAuthTag(payload.subarray(12, 28));
            decipher.update(payload.subarray(28));
            decipher.final();
          } catch { throw new Error('Billing key does not decrypt saved settings'); }
        }
      }
    }
  } finally { db.close(); }
}
