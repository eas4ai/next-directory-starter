import { createDecipheriv, createHash } from 'node:crypto';
import { createReadStream, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import Database from 'better-sqlite3';
import { DEFAULT_DATABASE_URL, parseDatabaseUrl } from '../src/lib/database-url.mjs';
import {
  canonicalProfileJson, parseDirectoryProfileDefinition, profileDigest, validProfileDate,
} from './addons/profile-schema.mjs';

export function databasePath() {
  return resolve(parseDatabaseUrl(process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL));
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

const profileTables = [
  'directory_profile_definitions', 'directory_profile_state', 'directory_profile_values',
  'directory_profile_changes', 'directory_profile_media', 'directory_profile_seed_runs',
  'directory_profile_search',
];
const profileValueColumns = [
  'text_value', 'integer_value', 'real_value', 'currency', 'date_start', 'date_end',
  'country_code', 'region', 'locality', 'latitude_e6', 'longitude_e6', 'media_id',
];
const profileItemPattern = /^[a-z0-9][a-z0-9._-]{0,119}$/i;
const profileMediaPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function profileFailure(message, cause) {
  throw new Error(`Directory profile integrity failed: ${message}`, cause ? { cause } : undefined);
}

function profileKey(profileId, version) {
  return `${profileId}\0${version}`;
}

function requireProfileObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) profileFailure(`${label} is invalid`);
  return value;
}

function parseProfileJson(value, label) {
  try { return requireProfileObject(JSON.parse(value), label); }
  catch (error) { profileFailure(`${label} is not valid JSON`, error); }
}

function inspectProfileDefinitions(db) {
  const definitions = new Map();
  for (const row of db.prepare(`SELECT profile_id, version, name, digest, source_kind,
      source_id, definition_json FROM directory_profile_definitions`).iterate()) {
    let definition;
    try { definition = parseDirectoryProfileDefinition(JSON.parse(row.definition_json)); }
    catch (error) { profileFailure(`stored definition ${row.profile_id}@${row.version} is invalid`, error); }
    const digest = profileDigest(definition);
    if (definition.id !== row.profile_id || definition.version !== row.version ||
        definition.name !== row.name || digest !== row.digest ||
        canonicalProfileJson(definition) !== row.definition_json) {
      profileFailure(`stored definition ${row.profile_id}@${row.version} changed identity or digest`);
    }
    const key = profileKey(row.profile_id, row.version);
    if (definitions.has(key)) profileFailure(`stored definition ${row.profile_id}@${row.version} is duplicated`);
    definitions.set(key, { definition, sourceKind: row.source_kind, sourceId: row.source_id });
  }
  return definitions;
}

function inspectProfileState(db, definitions) {
  const rows = db.prepare(`SELECT id, base_profile_id, base_profile_version,
      site_profile_id, site_profile_version, revision FROM directory_profile_state`).all();
  if (rows.length !== 1 || rows[0].id !== 1 || !Number.isSafeInteger(rows[0].revision) ||
      rows[0].revision < 0) profileFailure('active state singleton is invalid');
  const state = rows[0];
  const active = new Set();
  for (const [label, id, version] of [
    ['base', state.base_profile_id, state.base_profile_version],
    ['site', state.site_profile_id, state.site_profile_version],
  ]) {
    if ((id === null) !== (version === null)) profileFailure(`${label} active reference is incomplete`);
    if (id !== null) {
      const key = profileKey(id, version);
      if (!definitions.has(key)) profileFailure(`${label} active definition reference is missing`);
      active.add(key);
    }
  }
  if (state.site_profile_id !== null && state.site_profile_id !== 'site.local') {
    profileFailure('site active reference does not name site.local');
  }
  return active;
}

function scaledProfileDecimal(value, scale) {
  if (typeof value !== 'string' || !/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) {
    profileFailure('decimal constraint is invalid');
  }
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.');
  const scaled = BigInt(whole) * (10n ** BigInt(scale)) +
    BigInt((fraction + '0'.repeat(scale)).slice(0, scale) || '0');
  return Number(negative ? -scaled : scaled);
}

const profileAllowedColumns = {
  'short-text': ['text_value'], markdown: ['text_value'], boolean: ['integer_value'],
  integer: ['integer_value'], decimal: ['integer_value'], money: ['integer_value', 'currency'],
  'single-choice': ['text_value'], 'multiple-choice': ['text_value'], url: ['text_value'],
  date: ['date_start'], datetime: ['date_start'], 'date-range': ['date_start', 'date_end'],
  duration: ['integer_value'],
  location: ['country_code', 'region', 'locality', 'latitude_e6', 'longitude_e6'],
  media: ['media_id'],
};

function assertProfileValue(valid, field, label) {
  if (!valid) profileFailure(`${label} value ${field.key} violates its definition`);
}

function inspectProfileText(field, row) {
  const value = row.text_value;
  assertProfileValue(typeof value === 'string' && value.length >= field.constraints.minLength &&
    value.length <= field.constraints.maxLength && value.normalize('NFC') === value &&
    (field.type !== 'short-text' || value.trim() === value), field, 'text');
}

function inspectProfileBoolean(field, row) {
  assertProfileValue([0, 1].includes(row.integer_value), field, 'boolean');
}

function inspectProfileInteger(field, row) {
  const value = row.integer_value;
  assertProfileValue(Number.isSafeInteger(value) && value >= field.constraints.min &&
    value <= field.constraints.max, field, 'integer');
}

function inspectProfileDecimal(field, row) {
  const value = row.integer_value;
  assertProfileValue(Number.isSafeInteger(value) &&
    value >= scaledProfileDecimal(field.constraints.min, field.constraints.scale) &&
    value <= scaledProfileDecimal(field.constraints.max, field.constraints.scale), field, 'decimal');
}

function inspectProfileMoney(field, row) {
  const value = row.integer_value;
  assertProfileValue(Number.isSafeInteger(value) && value >= field.constraints.minMinor &&
    value <= field.constraints.maxMinor && field.constraints.currencies.includes(row.currency),
  field, 'money');
}

function inspectProfileChoice(field, row) {
  assertProfileValue(field.constraints.choices.some(({ value }) => value === row.text_value),
    field, 'choice');
}

function inspectProfileUrl(field, row) {
  let url;
  try { url = new URL(row.text_value); }
  catch (error) { profileFailure(`URL value ${field.key} is invalid`, error); }
  assertProfileValue(['http:', 'https:'].includes(url.protocol) && Boolean(url.hostname) &&
    !url.username && !url.password && url.href === row.text_value, field, 'URL');
}

function inspectProfileDate(field, row) {
  assertProfileValue(validProfileDate(row.date_start) && row.date_start >= field.constraints.min &&
    row.date_start <= field.constraints.max, field, 'date');
}

function inspectProfileDateTime(field, row) {
  const value = row.date_start;
  assertProfileValue(typeof value === 'string' && !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString() === value && value >= field.constraints.min &&
    value <= field.constraints.max, field, 'date/time');
}

function inspectProfileDateRange(field, row) {
  assertProfileValue(validProfileDate(row.date_start) && validProfileDate(row.date_end) &&
    row.date_start <= row.date_end && row.date_start >= field.constraints.min &&
    row.date_end <= field.constraints.max, field, 'date range');
}

function inspectProfileDuration(field, row) {
  const value = row.integer_value;
  assertProfileValue(Number.isSafeInteger(value) && value >= field.constraints.minSeconds &&
    value <= field.constraints.maxSeconds, field, 'duration');
}

function inspectProfileLocation(field, row) {
  const pairedCoordinates = (row.latitude_e6 === null) === (row.longitude_e6 === null);
  const coordinatesValid = row.latitude_e6 === null || Number.isSafeInteger(row.latitude_e6) &&
    Number.isSafeInteger(row.longitude_e6) && Math.abs(row.latitude_e6) <= 90_000_000 &&
    Math.abs(row.longitude_e6) <= 180_000_000;
  assertProfileValue(field.constraints.countries.includes(row.country_code) && pairedCoordinates &&
    (row.region === null || typeof row.region === 'string' && row.region.length <= 120) &&
    (row.locality === null || typeof row.locality === 'string' && row.locality.length <= 120) &&
    coordinatesValid, field, 'location');
}

function inspectProfileMediaValue(field, row) {
  assertProfileValue(typeof row.media_id === 'string' && profileMediaPattern.test(row.media_id),
    field, 'media');
}

const profileValueInspectors = {
  'short-text': inspectProfileText,
  markdown: inspectProfileText,
  boolean: inspectProfileBoolean,
  integer: inspectProfileInteger,
  decimal: inspectProfileDecimal,
  money: inspectProfileMoney,
  'single-choice': inspectProfileChoice,
  'multiple-choice': inspectProfileChoice,
  url: inspectProfileUrl,
  date: inspectProfileDate,
  datetime: inspectProfileDateTime,
  'date-range': inspectProfileDateRange,
  duration: inspectProfileDuration,
  location: inspectProfileLocation,
  media: inspectProfileMediaValue,
};

function inspectProfileValueShape(field, row) {
  const allowed = profileAllowedColumns[field.type];
  if (!allowed || profileValueColumns.some((column) => !allowed.includes(column) && row[column] !== null)) {
    profileFailure(`value ${row.field_key} has columns inconsistent with ${field.type}`);
  }
  profileValueInspectors[field.type](field, row);
}

function consecutiveProfilePositions(items, label) {
  const positions = [...new Set(items.map(({ position }) => position))].sort((a, b) => a - b);
  if (positions.some((position, index) => position !== index)) {
    profileFailure(`${label} positions are not canonical`);
  }
}

function collectProfileValueGroups(db, definitions, active) {
  const groups = new Map();
  for (const row of db.prepare('SELECT * FROM directory_profile_values').iterate()) {
    const stored = definitions.get(profileKey(row.profile_id, row.definition_version));
    if (!stored) profileFailure(`value ${row.field_key} references a missing definition`);
    if (row.archived_at === null && !active.has(profileKey(row.profile_id, row.definition_version))) {
      profileFailure(`current value ${row.field_key} references an inactive definition`);
    }
    const field = stored.definition.fields.find(({ key }) => key === row.field_key);
    if (!field) profileFailure(`value references missing field ${row.field_key}`);
    const groupKey = [row.listing_slug, row.profile_id, row.definition_version, row.field_key,
      row.archived_at ?? 'current'].join('\0');
    const group = groups.get(groupKey) ?? { field, rows: [] };
    group.rows.push(row);
    groups.set(groupKey, group);
  }
  return groups;
}

function inspectProfileGroupRows(field, rows) {
  const children = new Map(field.constraints.children.map((child) => [child.key, child]));
  const items = new Map();
  for (const row of rows) {
    const child = children.get(row.child_key);
    if (!profileItemPattern.test(row.item_id) || !child || row.value_type !== child.type) {
      profileFailure(`group value ${field.key} has an invalid item or child definition`);
    }
    inspectProfileValueShape(child, row);
    const item = items.get(row.item_id) ?? { position: row.position, children: new Set() };
    if (item.position !== row.position || item.children.has(row.child_key)) {
      profileFailure(`group value ${field.key} has inconsistent item identity`);
    }
    item.children.add(row.child_key);
    items.set(row.item_id, item);
  }
  if (items.size < field.constraints.minItems || items.size > field.constraints.maxItems) {
    profileFailure(`group value ${field.key} violates item bounds`);
  }
  consecutiveProfilePositions([...items.values()], `group value ${field.key}`);
  for (const item of items.values()) {
    for (const child of children.values()) {
      if (child.required && !item.children.has(child.key)) {
        profileFailure(`group value ${field.key} is missing required child ${child.key}`);
      }
    }
  }
}

function inspectProfileScalarRows(field, rows) {
  for (const row of rows) {
    if (row.child_key !== '' || row.value_type !== field.type) {
      profileFailure(`value ${field.key} does not match its stored field definition`);
    }
    inspectProfileValueShape(field, row);
  }
  if (field.type === 'multiple-choice') {
    if (rows.some((row) => row.item_id !== row.text_value) ||
        new Set(rows.map(({ text_value }) => text_value)).size !== rows.length) {
      profileFailure(`multiple-choice value ${field.key} has invalid item identity`);
    }
    consecutiveProfilePositions(rows, `multiple-choice value ${field.key}`);
    return;
  }
  if (field.cardinality === 'many') {
    if (rows.some(({ item_id }) => !profileItemPattern.test(item_id)) ||
        new Set(rows.map(({ item_id }) => item_id)).size !== rows.length) {
      profileFailure(`repeated value ${field.key} has invalid item identity`);
    }
    consecutiveProfilePositions(rows, `repeated value ${field.key}`);
    const maximum = field.type === 'media' ? field.constraints.maxItems : 25;
    if (rows.length > maximum) profileFailure(`repeated value ${field.key} exceeds its bound`);
    return;
  }
  if (rows.length !== 1 || rows[0].item_id !== 'value' || rows[0].position !== 0) {
    profileFailure(`scalar value ${field.key} is not canonical`);
  }
}

function inspectProfileValues(db, definitions, active) {
  const groups = collectProfileValueGroups(db, definitions, active);
  const mediaValues = [];
  for (const { field, rows } of groups.values()) {
    if (field.type === 'group') inspectProfileGroupRows(field, rows);
    else inspectProfileScalarRows(field, rows);
    mediaValues.push(...rows.filter(({ media_id: mediaId }) => mediaId !== null));
  }
  return mediaValues;
}

function inspectProfileMedia(db, definitions, mediaValues) {
  const assets = new Map(db.prepare(`SELECT id, target_kind, target_slug
    FROM media_assets`).all().map((row) => [row.id, row]));
  const records = new Map();
  for (const row of db.prepare('SELECT * FROM directory_profile_media').iterate()) {
    const asset = assets.get(row.asset_id);
    if (!asset || asset.target_kind !== 'listing' || asset.target_slug !== row.listing_slug) {
      profileFailure(`profile media ${row.asset_id} has an invalid asset reference`);
    }
    const fieldExists = [...definitions.values()].some(({ definition }) =>
      definition.fields.some((field) => field.key === row.field_key &&
        (field.type === 'media' || field.type === 'group' &&
          field.constraints.children.some((child) => child.type === 'media'))));
    if (!fieldExists || !profileItemPattern.test(row.item_id)) {
      profileFailure(`profile media ${row.asset_id} has an invalid field reference`);
    }
    records.set(row.asset_id, row);
  }
  for (const row of mediaValues) {
    const media = records.get(row.media_id);
    if (!media || media.listing_slug !== row.listing_slug || media.field_key !== row.field_key ||
        media.item_id !== row.item_id) {
      profileFailure(`profile media value ${row.media_id} has no owned media record`);
    }
  }
}

function definitionForReference(definitions, id, version, label) {
  if ((id === null) !== (version === null)) profileFailure(`${label} reference is incomplete`);
  if (id === null) return null;
  const stored = definitions.get(profileKey(id, version));
  if (!stored) profileFailure(`${label} definition reference is missing`);
  return stored.definition;
}

function inspectProfileChanges(db, definitions) {
  for (const row of db.prepare('SELECT * FROM directory_profile_changes').iterate()) {
    const impact = parseProfileJson(row.impact_json, `migration ${row.id} impact`);
    void impact;
    if (row.kind === 'purge') {
      if (typeof row.from_profile_id !== 'string' || row.from_version !== null ||
          row.to_profile_id !== null || row.to_version !== null) {
        profileFailure(`purge migration ${row.id} has invalid references`);
      }
      const plan = parseProfileJson(row.plan_json, `purge migration ${row.id} plan`);
      if (typeof plan.fieldKey !== 'string' || ![...definitions.values()].some(({ definition }) =>
        definition.id === row.from_profile_id && definition.fields.some(({ key }) => key === plan.fieldKey))) {
        profileFailure(`purge migration ${row.id} references a missing field`);
      }
      continue;
    }
    const from = definitionForReference(definitions, row.from_profile_id, row.from_version,
      `migration ${row.id} source`);
    const to = definitionForReference(definitions, row.to_profile_id, row.to_version,
      `migration ${row.id} target`);
    if (!to && row.kind !== 'site-archive') profileFailure(`migration ${row.id} has no target definition`);
    const plan = parseProfileJson(row.plan_json, `migration ${row.id} plan`);
    const fields = requireProfileObject(plan.fields, `migration ${row.id} fields`);
    const defaults = requireProfileObject(plan.defaults, `migration ${row.id} defaults`);
    for (const [source, actionValue] of Object.entries(fields)) {
      if (!from?.fields.some(({ key }) => key === source)) {
        profileFailure(`migration ${row.id} references missing source field ${source}`);
      }
      const action = requireProfileObject(actionValue, `migration ${row.id} action`);
      if (action.action === 'archive') continue;
      if (action.action !== 'map' || typeof action.to !== 'string' ||
          !to?.fields.some(({ key }) => key === action.to) || !['reject', 'archive'].includes(action.onInvalid)) {
        profileFailure(`migration ${row.id} has an invalid field mapping`);
      }
    }
    for (const target of Object.keys(defaults)) if (!to?.fields.some(({ key }) => key === target)) {
      profileFailure(`migration ${row.id} references missing default field ${target}`);
    }
  }
}

function inspectProfileSeeds(db, definitions) {
  for (const row of db.prepare('SELECT * FROM directory_profile_seed_runs').iterate()) {
    const stored = definitions.get(profileKey(row.profile_id, row.profile_version));
    if (!stored || stored.sourceKind !== 'addon' || stored.sourceId !== row.addon_id ||
        typeof row.seed_digest !== 'string' || !/^[0-9a-f]{64}$/.test(row.seed_digest) ||
        !Number.isSafeInteger(row.record_count) || row.record_count < 0) {
      profileFailure(`seed run ${row.addon_id}@${row.addon_version} has an invalid definition reference`);
    }
  }
}

function inspectProfileSearch(db, definitions, active) {
  for (const row of db.prepare('SELECT listing_slug, profile_id, field_key, value FROM directory_profile_search')
    .iterate()) {
    const candidates = [...active].map((key) => definitions.get(key)?.definition)
      .filter((definition) => definition?.id === row.profile_id);
    const field = candidates.flatMap((definition) => definition.fields)
      .find(({ key }) => key === row.field_key);
    if (!field || field.visibility !== 'public' || !field.searchable || typeof row.value !== 'string') {
      profileFailure(`search row ${row.profile_id}:${row.field_key} has an invalid active definition reference`);
    }
  }
}

function inspectDirectoryProfiles(db, tables) {
  const present = profileTables.filter((table) => tables.includes(table));
  if (!present.length) return;
  if (present.length !== profileTables.length) profileFailure('profile schema is incomplete');
  const definitions = inspectProfileDefinitions(db);
  const active = inspectProfileState(db, definitions);
  const mediaValues = inspectProfileValues(db, definitions, active);
  inspectProfileMedia(db, definitions, mediaValues);
  inspectProfileChanges(db, definitions);
  inspectProfileSeeds(db, definitions);
  inspectProfileSearch(db, definitions, active);
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
            !lstatSync(join(mediaDirectory, `${id}.webp`), { throwIfNoEntry: false })?.isFile()) {
          throw new Error('An uploaded media file is missing');
        }
      }
    }
    inspectDirectoryProfiles(db, tables);
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
