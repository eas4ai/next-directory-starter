import { randomUUID } from "node:crypto";
import { canAdmin, requireCurrentActor } from "@/lib/admin";
import { recordAudit } from "@/lib/audit";
import { migrateCatalog } from "@/lib/catalog-migrations";
import { database } from "@/lib/database";
import type {
  ActiveProfileSet, DirectoryProfileDefinition, DirectoryProfileField,
  DirectoryProfileState, NormalizedProfileRow, ProfileChildField, ProfileImpact,
  ProfileMigrationAction, ProfileMigrationPlan, StoredProfileReference,
} from "@/lib/directory-profile-types";
import {
  decodeProfileValue, encodeProfileValue, reindexProfileSearch,
  validateProfileFieldValue,
} from "@/lib/profile-values";
import {
  PROFILE_LIMITS, canonicalProfileJson, parseDirectoryProfileDefinition, profileDigest,
} from "../../scripts/addons/profile-schema.mjs";

export { canonicalProfileJson, parseDirectoryProfileDefinition, profileDigest };

migrateCatalog();

type StateRow = {
  base_profile_id: string | null;
  base_profile_version: string | null;
  site_profile_id: string | null;
  site_profile_version: string | null;
  revision: number;
};

type DefinitionRow = {
  profile_id: string;
  version: string;
  name: string;
  digest: string;
  source_kind: "addon" | "site";
  source_id: string | null;
  definition_json: string;
  created_at: string;
};

type ValueRow = {
  listing_slug: string;
  profile_id: string;
  definition_version: string;
  field_key: string;
  item_id: string;
  child_key: string;
  position: number;
  value_type: NormalizedProfileRow["valueType"];
  text_value: string | null;
  integer_value: number | null;
  real_value: number | null;
  currency: string | null;
  date_start: string | null;
  date_end: string | null;
  country_code: string | null;
  region: string | null;
  locality: string | null;
  latitude_e6: number | null;
  longitude_e6: number | null;
  media_id: string | null;
};

export type StoredProfileSummary = StoredProfileReference & {
  sourceKind: "addon" | "site";
  sourceId: string | null;
  createdAt: string;
  active: boolean;
};

function stateRow(): StateRow {
  const row = database.prepare(`SELECT base_profile_id, base_profile_version,
      site_profile_id, site_profile_version, revision
    FROM directory_profile_state WHERE id = 1`).get() as StateRow | undefined;
  if (!row) throw new Error("Directory profile state is missing");
  return row;
}

function definitionRow(profileId: string, version: string): DefinitionRow {
  const row = database.prepare(`SELECT profile_id, version, name, digest, source_kind,
      source_id, definition_json, created_at
    FROM directory_profile_definitions WHERE profile_id = ? AND version = ?`)
    .get(profileId, version) as DefinitionRow | undefined;
  if (!row) throw new Error(`Stored directory profile is missing: ${profileId}@${version}`);
  return row;
}

function reference(profileId: string | null, version: string | null): StoredProfileReference | null {
  if (!profileId || !version) return null;
  const row = definitionRow(profileId, version);
  return { profileId: row.profile_id, version: row.version, digest: row.digest, name: row.name };
}

function stateFromRow(row: StateRow): DirectoryProfileState {
  return {
    revision: row.revision,
    base: reference(row.base_profile_id, row.base_profile_version),
    site: reference(row.site_profile_id, row.site_profile_version),
  };
}

export function directoryProfileState(): DirectoryProfileState {
  return stateFromRow(stateRow());
}

export function availableDirectoryProfiles(): StoredProfileSummary[] {
  const state = stateRow();
  const active = new Set([
    state.base_profile_id && state.base_profile_version
      ? `${state.base_profile_id}\0${state.base_profile_version}` : null,
    state.site_profile_id && state.site_profile_version
      ? `${state.site_profile_id}\0${state.site_profile_version}` : null,
  ].filter(Boolean));
  const rows = database.prepare(`SELECT profile_id, version, name, digest, source_kind,
      source_id, definition_json, created_at
    FROM directory_profile_definitions ORDER BY profile_id, version`).all() as DefinitionRow[];
  return rows.map((row) => ({
    profileId: row.profile_id,
    version: row.version,
    digest: row.digest,
    name: row.name,
    sourceKind: row.source_kind,
    sourceId: row.source_id,
    createdAt: row.created_at,
    active: active.has(`${row.profile_id}\0${row.version}`),
  }));
}

export function storedDirectoryProfileDefinition(profileId: string,
  version: string): DirectoryProfileDefinition {
  if (!profileId || !version) throw new Error("A stored profile ID and version are required");
  return readDefinition(profileId, version);
}

function readDefinition(profileId: string, version: string): DirectoryProfileDefinition {
  return parseDirectoryProfileDefinition(JSON.parse(definitionRow(profileId, version).definition_json)) as
    DirectoryProfileDefinition;
}

export function activeDirectoryProfiles(): ActiveProfileSet {
  const state = directoryProfileState();
  return {
    state,
    definitions: [state.base, state.site].filter((value): value is StoredProfileReference =>
      value !== null).map((value) => readDefinition(value.profileId, value.version)),
  };
}

function currentReference(row: StateRow, definition: DirectoryProfileDefinition):
StoredProfileReference | null {
  const isSite = definition.id === "site.local";
  return reference(isSite ? row.site_profile_id : row.base_profile_id,
    isSite ? row.site_profile_version : row.base_profile_version);
}

function numericConstraint(field: DirectoryProfileField | ProfileChildField, key: string): number {
  return field.constraints[key] as number;
}

function stringConstraint(field: DirectoryProfileField | ProfileChildField, key: string): string {
  return field.constraints[key] as string;
}

function choices(field: DirectoryProfileField | ProfileChildField): string[] {
  return (field.constraints.choices as { value: string }[] | undefined)?.map(({ value }) => value) ?? [];
}

function children(field: DirectoryProfileField): ProfileChildField[] {
  return field.constraints.children as ProfileChildField[];
}

function scalarConstraintsWiden(oldField: DirectoryProfileField | ProfileChildField,
  nextField: DirectoryProfileField | ProfileChildField): boolean {
  if (oldField.type !== nextField.type) return false;
  switch (oldField.type) {
    case "short-text":
    case "markdown":
      return numericConstraint(nextField, "minLength") <= numericConstraint(oldField, "minLength") &&
        numericConstraint(nextField, "maxLength") >= numericConstraint(oldField, "maxLength");
    case "integer":
      return numericConstraint(nextField, "min") <= numericConstraint(oldField, "min") &&
        numericConstraint(nextField, "max") >= numericConstraint(oldField, "max");
    case "decimal":
      return numericConstraint(nextField, "scale") === numericConstraint(oldField, "scale") &&
        Number(stringConstraint(nextField, "min")) <= Number(stringConstraint(oldField, "min")) &&
        Number(stringConstraint(nextField, "max")) >= Number(stringConstraint(oldField, "max"));
    case "money": {
      const nextCurrencies = new Set(nextField.constraints.currencies as string[]);
      return numericConstraint(nextField, "minMinor") <= numericConstraint(oldField, "minMinor") &&
        numericConstraint(nextField, "maxMinor") >= numericConstraint(oldField, "maxMinor") &&
        (oldField.constraints.currencies as string[]).every((value) => nextCurrencies.has(value));
    }
    case "single-choice":
    case "multiple-choice": {
      const nextChoices = new Set(choices(nextField));
      return choices(oldField).every((value) => nextChoices.has(value));
    }
    case "date":
    case "datetime":
    case "date-range":
      return stringConstraint(nextField, "min") <= stringConstraint(oldField, "min") &&
        stringConstraint(nextField, "max") >= stringConstraint(oldField, "max");
    case "duration":
      return numericConstraint(nextField, "minSeconds") <= numericConstraint(oldField, "minSeconds") &&
        numericConstraint(nextField, "maxSeconds") >= numericConstraint(oldField, "maxSeconds");
    case "location": {
      const countries = new Set(nextField.constraints.countries as string[]);
      return (oldField.constraints.countries as string[]).every((value) => countries.has(value));
    }
    case "media":
      return numericConstraint(nextField, "maxItems") >= numericConstraint(oldField, "maxItems");
    case "boolean":
    case "url":
      return true;
    default:
      return false;
  }
}

function fieldCompatible(oldField: DirectoryProfileField, nextField: DirectoryProfileField): boolean {
  if (oldField.type !== nextField.type || oldField.cardinality !== nextField.cardinality ||
      oldField.writeAuthority !== nextField.writeAuthority ||
      oldField.visibility !== nextField.visibility || (!oldField.required && nextField.required)) return false;
  if (oldField.type !== "group") return scalarConstraintsWiden(oldField, nextField);
  const oldChildren = children(oldField);
  const nextChildren = new Map(children(nextField).map((field) => [field.key, field]));
  if (numericConstraint(nextField, "minItems") > numericConstraint(oldField, "minItems") ||
      numericConstraint(nextField, "maxItems") < numericConstraint(oldField, "maxItems")) return false;
  return oldChildren.every((oldChild) => {
    const nextChild = nextChildren.get(oldChild.key);
    return Boolean(nextChild) && !(!oldChild.required && nextChild!.required) &&
      scalarConstraintsWiden(oldChild, nextChild!);
  }) && children(nextField).filter(({ key }) => !oldChildren.some((field) => field.key === key))
    .every((field) => !field.required);
}

function normalizedRow(row: ValueRow): NormalizedProfileRow {
  return {
    itemId: row.item_id, childKey: row.child_key, position: row.position,
    valueType: row.value_type, textValue: row.text_value, integerValue: row.integer_value,
    realValue: row.real_value, currency: row.currency, dateStart: row.date_start,
    dateEnd: row.date_end, countryCode: row.country_code, region: row.region,
    locality: row.locality, latitudeE6: row.latitude_e6, longitudeE6: row.longitude_e6,
    mediaId: row.media_id,
  };
}

function currentRows(referenceValue: StoredProfileReference | null): ValueRow[] {
  if (!referenceValue) return [];
  return database.prepare(`SELECT listing_slug, profile_id, definition_version, field_key,
      item_id, child_key, position, value_type, text_value, integer_value, real_value,
      currency, date_start, date_end, country_code, region, locality, latitude_e6,
      longitude_e6, media_id
    FROM directory_profile_values
    WHERE profile_id = ? AND definition_version = ? AND archived_at IS NULL
    ORDER BY listing_slug, field_key, position, item_id, child_key
    LIMIT ?`).all(referenceValue.profileId, referenceValue.version,
      PROFILE_LIMITS.migrationRows + 1) as ValueRow[];
}

function rowGroups(rows: ValueRow[]): Map<string, ValueRow[]> {
  const groups = new Map<string, ValueRow[]>();
  for (const row of rows) {
    const key = `${row.listing_slug}\0${row.field_key}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return groups;
}

function validateRevision(expectedRevision: number, actualRevision: number): void {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== actualRevision) {
    throw new Error(`Directory profile revision changed; expected ${expectedRevision}, found ${actualRevision}`);
  }
}

function mappingFor(plan: ProfileMigrationPlan | undefined, fieldKey: string):
ProfileMigrationAction | undefined {
  return plan?.fields?.[fieldKey];
}

function mappedValue(value: unknown, action: ProfileMigrationAction): unknown {
  if (action.action !== "map" || !action.choiceMap) return value;
  const mapOne = (entry: unknown) => typeof entry === "string" && action.choiceMap?.[entry]
    ? action.choiceMap[entry] : entry;
  if (Array.isArray(value)) return value.map((entry) => mapOne(entry));
  return mapOne(value);
}

function impactFor(definition: DirectoryProfileDefinition, expectedRevision: number,
  migration?: ProfileMigrationPlan): ProfileImpact {
  const row = stateRow();
  validateRevision(expectedRevision, row.revision);
  const current = currentReference(row, definition);
  const oldDefinition = current ? readDefinition(current.profileId, current.version) : null;
  const rows = currentRows(current);
  if (rows.length > PROFILE_LIMITS.migrationRows) {
    throw new Error("Directory profile migration exceeds the 100,000 value row online limit");
  }
  const oldFields = new Map(oldDefinition?.fields.map((field) => [field.key, field]) ?? []);
  const nextFields = new Map(definition.fields.map((field) => [field.key, field]));
  const breaking = new Set<string>();
  for (const oldField of oldFields.values()) {
    const nextField = nextFields.get(oldField.key);
    if (!nextField || !fieldCompatible(oldField, nextField)) breaking.add(oldField.key);
  }
  for (const nextField of nextFields.values()) {
    if (!oldFields.has(nextField.key) && nextField.required) breaking.add(nextField.key);
  }

  const invalidSamples: ProfileImpact["invalidSamples"] = [];
  const futureKeys = new Set<string>();
  for (const [groupKey, groupRows] of rowGroups(rows)) {
    const separator = groupKey.indexOf("\0");
    const slug = groupKey.slice(0, separator);
    const fieldKey = groupKey.slice(separator + 1);
    const oldField = oldFields.get(fieldKey);
    if (!oldField) continue;
    const action = mappingFor(migration, fieldKey);
    const nextField = action?.action === "map" ? nextFields.get(action.to) : nextFields.get(fieldKey);
    if (!nextField || action?.action === "archive") continue;
    try {
      const value = decodeProfileValue(oldField, groupRows.map(normalizedRow));
      validateProfileFieldValue(nextField, mappedValue(value, action ?? { action: "map", to: fieldKey,
        onInvalid: "reject" }));
      futureKeys.add(`${slug}\0${nextField.key}`);
    } catch (error) {
      if (invalidSamples.length < 20) invalidSamples.push({ slug, fieldKey,
        reason: error instanceof Error ? error.message : "Invalid stored value" });
    }
  }

  const listingRows = database.prepare("SELECT slug, status FROM listings").all() as
    { slug: string; status: string }[];
  const publishedMissing = new Set<string>();
  for (const field of definition.fields.filter(({ required }) => required)) {
    const supplied = migration?.defaults?.[field.key] ?? field.default;
    if (supplied !== undefined) validateProfileFieldValue(field, supplied);
    for (const listing of listingRows) {
      if (listing.status === "published" && !futureKeys.has(`${listing.slug}\0${field.key}`) &&
          supplied === undefined) publishedMissing.add(listing.slug);
    }
  }
  return {
    compatible: breaking.size === 0,
    breakingFields: [...breaking].sort(),
    affectedListings: new Set(rows.map(({ listing_slug }) => listing_slug)).size,
    affectedValues: rows.length,
    publishedMissingRequired: publishedMissing.size,
    invalidSamples,
    stateRevision: row.revision,
  };
}

export function profileImpact(input: {
  definition: unknown;
  expectedRevision: number;
  migration?: ProfileMigrationPlan;
}): ProfileImpact {
  const definition = parseDirectoryProfileDefinition(input.definition) as DirectoryProfileDefinition;
  return impactFor(definition, input.expectedRevision, input.migration);
}

export function archivedProfileValueCount(input: {
  profileId: string;
  fieldKey: string;
  expectedRevision: number;
}): number {
  const state = stateRow();
  validateRevision(input.expectedRevision, state.revision);
  return (database.prepare(`SELECT COUNT(*) AS count FROM directory_profile_values
    WHERE profile_id = ? AND field_key = ? AND archived_at IS NOT NULL`)
    .get(input.profileId, input.fieldKey) as { count: number }).count;
}

function insertNormalizedValue(listingSlug: string, profileId: string, version: string,
  fieldKey: string, row: NormalizedProfileRow, now: string): void {
  database.prepare(`INSERT INTO directory_profile_values
    (listing_slug, profile_id, definition_version, field_key, item_id, child_key,
      position, value_type, text_value, integer_value, real_value, currency, date_start,
      date_end, country_code, region, locality, latitude_e6, longitude_e6, media_id,
      archived_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`)
    .run(listingSlug, profileId, version, fieldKey, row.itemId, row.childKey, row.position,
      row.valueType, row.textValue, row.integerValue, row.realValue, row.currency,
      row.dateStart, row.dateEnd, row.countryCode, row.region, row.locality,
      row.latitudeE6, row.longitudeE6, row.mediaId, now);
}

function writeValue(listingSlug: string, definition: DirectoryProfileDefinition,
  field: DirectoryProfileField, value: unknown, now: string): void {
  const canonical = validateProfileFieldValue(field, value);
  for (const row of encodeProfileValue(field, canonical)) {
    insertNormalizedValue(listingSlug, definition.id, definition.version, field.key, row, now);
  }
}

function validateMigration(definition: DirectoryProfileDefinition, oldDefinition: DirectoryProfileDefinition | null,
  rows: ValueRow[], impact: ProfileImpact, migration?: ProfileMigrationPlan): void {
  const nextFields = new Map(definition.fields.map((field) => [field.key, field]));
  const oldFields = new Map(oldDefinition?.fields.map((field) => [field.key, field]) ?? []);
  if (migration && (!migration.fields || typeof migration.fields !== "object" ||
      Array.isArray(migration.fields) || !migration.defaults || typeof migration.defaults !== "object" ||
      Array.isArray(migration.defaults))) throw new Error("Migration fields and defaults must be objects");
  const targets = new Set<string>();
  for (const [source, action] of Object.entries(migration?.fields ?? {})) {
    const oldField = oldFields.get(source);
    if (!oldField) throw new Error(`Migration source field is missing: ${source}`);
    if (!action || typeof action !== "object" || !["archive", "map"].includes(action.action)) {
      throw new Error(`Migration action is invalid for ${source}`);
    }
    const allowed = action.action === "archive" ? ["action"] : ["action", "to", "onInvalid", "choiceMap"];
    const unknown = Object.keys(action).find((key) => !allowed.includes(key));
    if (unknown) throw new Error(`Unknown migration action property for ${source}: ${unknown}`);
    if (action.action === "map" && !nextFields.has(action.to)) {
      throw new Error(`Migration target field is missing: ${action.to}`);
    }
    if (action.action === "map") {
      if (!action.to || !["reject", "archive"].includes(action.onInvalid)) {
        throw new Error(`Migration target or invalid-value policy is missing for ${source}`);
      }
      if (targets.has(action.to)) throw new Error(`Multiple migration fields target ${action.to}`);
      targets.add(action.to);
      if (action.choiceMap) {
        const nextField = nextFields.get(action.to)!;
        if (!["single-choice", "multiple-choice"].includes(oldField.type) ||
            !["single-choice", "multiple-choice"].includes(nextField.type)) {
          throw new Error(`Choice mapping is invalid for ${source}`);
        }
        const oldChoices = new Set(choices(oldField));
        const nextChoices = new Set(choices(nextField));
        for (const [from, to] of Object.entries(action.choiceMap)) {
          if (!oldChoices.has(from) || !nextChoices.has(to)) {
            throw new Error(`Choice mapping for ${source} contains an unknown value`);
          }
        }
      }
    }
  }
  for (const [fieldKey, value] of Object.entries(migration?.defaults ?? {})) {
    const field = nextFields.get(fieldKey);
    if (!field) throw new Error(`Migration default target field is missing: ${fieldKey}`);
    validateProfileFieldValue(field, value);
  }
  const valueFields = new Set(rows.map(({ field_key }) => field_key));
  for (const fieldKey of impact.breakingFields) {
    if (valueFields.has(fieldKey) && !mappingFor(migration, fieldKey)) {
      throw new Error(`Breaking field ${fieldKey} requires an explicit mapping or archive action`);
    }
  }
  if (impact.publishedMissingRequired > 0) {
    throw new Error("Required profile fields need a valid migration default for every published listing");
  }
}

function activateNow(input: {
  definition: unknown;
  sourceKind: "addon" | "site";
  sourceId?: string;
  expectedRevision: number;
  migration?: ProfileMigrationPlan;
  actorUserId: string;
}, options: { kind?: "activate" | "switch" | "site-save" | "site-archive";
  audit?: string } = {}): DirectoryProfileState {
  const definition = parseDirectoryProfileDefinition(input.definition) as DirectoryProfileDefinition;
  if (!(["addon", "site"] as string[]).includes(input.sourceKind)) {
    throw new Error("Invalid directory profile source kind");
  }
  const digest = profileDigest(definition) as string;
  const json = canonicalProfileJson(definition) as string;
  const now = new Date().toISOString();
  return database.transaction(() => {
    requireCurrentActor(input.actorUserId, canAdmin);
    const row = stateRow();
    validateRevision(input.expectedRevision, row.revision);
    const current = currentReference(row, definition);
    if (current?.profileId === definition.id && current.version === definition.version &&
        current.digest === digest) throw new Error("Directory profile version is already active");
    const impact = impactFor(definition, input.expectedRevision, input.migration);
    const oldDefinition = current ? readDefinition(current.profileId, current.version) : null;
    const rows = currentRows(current);
    if (rows.length > PROFILE_LIMITS.migrationRows) {
      throw new Error("Directory profile migration exceeds the 100,000 value row online limit");
    }
    const existing = database.prepare(`SELECT digest FROM directory_profile_definitions
      WHERE profile_id = ? AND version = ?`).get(definition.id, definition.version) as
      { digest: string } | undefined;
    if (existing && existing.digest !== digest) {
      throw new Error("Directory profile versions are immutable; the same version has a different digest");
    }
    validateMigration(definition, oldDefinition, rows, impact, input.migration);
    if (!existing) {
      database.prepare(`INSERT INTO directory_profile_definitions
        (profile_id, version, name, digest, source_kind, source_id, definition_json,
          created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(definition.id, definition.version, definition.name, digest, input.sourceKind,
          input.sourceId ?? null, json, now, input.actorUserId);
    }

    const nextFields = new Map(definition.fields.map((field) => [field.key, field]));
    const oldFields = new Map(oldDefinition?.fields.map((field) => [field.key, field]) ?? []);
    const affectedListings = new Set<string>();
    for (const [groupKey, groupRows] of rowGroups(rows)) {
      const separator = groupKey.indexOf("\0");
      const listingSlug = groupKey.slice(0, separator);
      const fieldKey = groupKey.slice(separator + 1);
      const oldField = oldFields.get(fieldKey);
      if (!oldField) throw new Error(`Stored field definition is missing: ${fieldKey}`);
      const action = mappingFor(input.migration, fieldKey);
      const targetField = action?.action === "map" ? nextFields.get(action.to) : nextFields.get(fieldKey);
      const sourceValue = decodeProfileValue(oldField, groupRows.map(normalizedRow));
      let targetValue: unknown;
      if (targetField && action?.action !== "archive") {
        try {
          targetValue = validateProfileFieldValue(targetField,
            mappedValue(sourceValue, action ?? { action: "map", to: fieldKey, onInvalid: "reject" }));
        } catch (error) {
          if (action?.action === "map" && action.onInvalid === "archive") targetValue = undefined;
          else throw error;
        }
      }
      database.prepare(`UPDATE directory_profile_values SET archived_at = ?, updated_at = ?
        WHERE listing_slug = ? AND profile_id = ? AND definition_version = ?
          AND field_key = ? AND archived_at IS NULL`)
        .run(now, now, listingSlug, current!.profileId, current!.version, fieldKey);
      if (targetField && targetValue !== undefined) {
        writeValue(listingSlug, definition, targetField, targetValue, now);
      }
      affectedListings.add(listingSlug);
    }

    const listings = database.prepare("SELECT slug, status FROM listings").all() as
      { slug: string; status: string }[];
    for (const field of definition.fields.filter(({ required }) => required)) {
      const value = input.migration?.defaults?.[field.key] ?? field.default;
      for (const listing of listings) {
        const present = database.prepare(`SELECT 1 FROM directory_profile_values
          WHERE listing_slug = ? AND profile_id = ? AND definition_version = ?
            AND field_key = ? AND archived_at IS NULL LIMIT 1`)
          .get(listing.slug, definition.id, definition.version, field.key);
        if (present) continue;
        if (value === undefined && listing.status === "published") {
          throw new Error(`Required field ${field.key} has no migration default`);
        }
        if (value !== undefined) {
          writeValue(listing.slug, definition, field, value, now);
          affectedListings.add(listing.slug);
        }
      }
    }

    const site = definition.id === "site.local";
    database.prepare(`UPDATE directory_profile_state SET
        base_profile_id = ?, base_profile_version = ?, site_profile_id = ?,
        site_profile_version = ?, revision = revision + 1, updated_at = ?, updated_by = ?
      WHERE id = 1 AND revision = ?`).run(
      site ? row.base_profile_id : definition.id,
      site ? row.base_profile_version : definition.version,
      site ? definition.id : row.site_profile_id,
      site ? definition.version : row.site_profile_version,
      now, input.actorUserId, input.expectedRevision,
    );
    const state = directoryProfileState();
    const profiles = activeDirectoryProfiles();
    for (const listing of affectedListings) reindexProfileSearch(listing, profiles);
    const kind = options.kind ?? (current && current.profileId !== definition.id ? "switch" : "activate");
    database.prepare(`INSERT INTO directory_profile_changes
      (id, kind, from_profile_id, from_version, to_profile_id, to_version, plan_json,
        impact_json, actor_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(randomUUID(), kind, current?.profileId ?? null, current?.version ?? null,
        definition.id, definition.version, JSON.stringify(input.migration ?? { fields: {}, defaults: {} }),
        JSON.stringify(impact), input.actorUserId, now);
    recordAudit(options.audit ?? "profile.activate", input.actorUserId,
      `${definition.id}@${definition.version}`);
    return state;
  }).immediate();
}

export function activateDirectoryProfile(input: {
  definition: unknown;
  sourceKind: "addon" | "site";
  sourceId?: string;
  expectedRevision: number;
  migration?: ProfileMigrationPlan;
  actorUserId: string;
}): DirectoryProfileState {
  return activateNow(input);
}

function siteDefinition(fields: DirectoryProfileField[], version: string): DirectoryProfileDefinition {
  return {
    schemaVersion: 1,
    id: "site.local",
    version,
    name: "Site fields",
    description: "Fields created and owned by this directory operator.",
    fields,
  };
}

export function saveSiteField(input: {
  field: unknown;
  expectedRevision: number;
  actorUserId: string;
}): DirectoryProfileState {
  const state = directoryProfileState();
  validateRevision(input.expectedRevision, state.revision);
  const existing = state.site ? readDefinition(state.site.profileId, state.site.version).fields : [];
  const raw = input.field as { key?: unknown };
  if (typeof raw?.key !== "string" || !raw.key.startsWith("site.")) {
    throw new Error("Site-owned field keys must use the site. namespace");
  }
  const fields = [...existing.filter(({ key }) => key !== raw.key), input.field as DirectoryProfileField];
  const definition = parseDirectoryProfileDefinition(siteDefinition(fields,
    `0.0.${state.revision + 1}`)) as DirectoryProfileDefinition;
  const oldField = existing.find(({ key }) => key === raw.key);
  const migration: ProfileMigrationPlan | undefined = oldField && !fieldCompatible(oldField,
    definition.fields.find(({ key }) => key === raw.key)!)
    ? { fields: { [oldField.key]: { action: "map", to: oldField.key,
      onInvalid: "reject" as const } }, defaults: {} } : undefined;
  return activateNow({ definition, sourceKind: "site", sourceId: "site",
    expectedRevision: input.expectedRevision, migration, actorUserId: input.actorUserId },
  { kind: "site-save", audit: "profile.site-field.save" });
}

export function archiveSiteField(input: {
  fieldKey: string;
  expectedRevision: number;
  actorUserId: string;
}): DirectoryProfileState {
  if (!input.fieldKey.startsWith("site.")) throw new Error("Site field must use the site. namespace");
  const state = directoryProfileState();
  validateRevision(input.expectedRevision, state.revision);
  if (!state.site) throw new Error("No site-owned profile is active");
  const current = readDefinition(state.site.profileId, state.site.version);
  if (!current.fields.some(({ key }) => key === input.fieldKey)) throw new Error("Site field is missing");
  const remaining = current.fields.filter(({ key }) => key !== input.fieldKey);
  if (remaining.length) {
    return activateNow({ definition: siteDefinition(remaining, `0.0.${state.revision + 1}`),
      sourceKind: "site", sourceId: "site", expectedRevision: input.expectedRevision,
      migration: { fields: { [input.fieldKey]: { action: "archive" } }, defaults: {} },
      actorUserId: input.actorUserId },
    { kind: "site-archive", audit: "profile.site-field.archive" });
  }
  const now = new Date().toISOString();
  return database.transaction(() => {
    requireCurrentActor(input.actorUserId, canAdmin);
    const row = stateRow();
    validateRevision(input.expectedRevision, row.revision);
    const affectedListings = (database.prepare(`SELECT DISTINCT listing_slug
      FROM directory_profile_values WHERE profile_id = 'site.local'
        AND definition_version = ? AND field_key = ? AND archived_at IS NULL`)
      .all(state.site!.version, input.fieldKey) as { listing_slug: string }[])
      .map(({ listing_slug }) => listing_slug);
    database.prepare(`UPDATE directory_profile_values SET archived_at = ?, updated_at = ?
      WHERE profile_id = 'site.local' AND definition_version = ? AND field_key = ?
        AND archived_at IS NULL`).run(now, now, state.site!.version, input.fieldKey);
    database.prepare(`UPDATE directory_profile_state SET site_profile_id = NULL,
      site_profile_version = NULL, revision = revision + 1, updated_at = ?, updated_by = ?
      WHERE id = 1 AND revision = ?`).run(now, input.actorUserId, input.expectedRevision);
    const profiles = activeDirectoryProfiles();
    for (const listingSlug of affectedListings) reindexProfileSearch(listingSlug, profiles);
    database.prepare(`INSERT INTO directory_profile_changes
      (id, kind, from_profile_id, from_version, to_profile_id, to_version, plan_json,
        impact_json, actor_user_id, created_at) VALUES (?, 'site-archive', ?, ?, NULL, NULL, ?, ?, ?, ?)`)
      .run(randomUUID(), state.site!.profileId, state.site!.version,
        JSON.stringify({ fields: { [input.fieldKey]: { action: "archive" } }, defaults: {} }),
        JSON.stringify({ fieldKey: input.fieldKey }), input.actorUserId, now);
    recordAudit("profile.site-field.archive", input.actorUserId, input.fieldKey);
    return directoryProfileState();
  }).immediate();
}

export function purgeArchivedProfileValues(input: {
  profileId: string;
  fieldKey: string;
  expectedCount: number;
  expectedRevision: number;
  actorUserId: string;
}): number {
  if (!Number.isSafeInteger(input.expectedCount) || input.expectedCount < 1) {
    throw new Error("Archived value count must be a positive integer");
  }
  return database.transaction(() => {
    requireCurrentActor(input.actorUserId, canAdmin);
    const row = stateRow();
    validateRevision(input.expectedRevision, row.revision);
    const count = (database.prepare(`SELECT COUNT(*) AS count FROM directory_profile_values
      WHERE profile_id = ? AND field_key = ? AND archived_at IS NOT NULL`)
      .get(input.profileId, input.fieldKey) as { count: number }).count;
    if (count !== input.expectedCount) {
      throw new Error(`Archived value count changed; expected ${input.expectedCount}, found ${count}`);
    }
    database.prepare(`DELETE FROM directory_profile_values
      WHERE profile_id = ? AND field_key = ? AND archived_at IS NOT NULL`)
      .run(input.profileId, input.fieldKey);
    const now = new Date().toISOString();
    database.prepare(`UPDATE directory_profile_state SET revision = revision + 1,
      updated_at = ?, updated_by = ? WHERE id = 1 AND revision = ?`)
      .run(now, input.actorUserId, input.expectedRevision);
    database.prepare(`INSERT INTO directory_profile_changes
      (id, kind, from_profile_id, from_version, to_profile_id, to_version, plan_json,
        impact_json, actor_user_id, created_at) VALUES (?, 'purge', ?, NULL, NULL, NULL, ?, ?, ?, ?)`)
      .run(randomUUID(), input.profileId, JSON.stringify({ fieldKey: input.fieldKey }),
        JSON.stringify({ count }), input.actorUserId, now);
    recordAudit("profile.values.purge", input.actorUserId,
      `${input.profileId}:${input.fieldKey}:${count}`);
    return count;
  }).immediate();
}
