import { database } from "@/lib/database";
import { HttpError } from "@/lib/http-error";
import type {
  ActiveProfileSet, CanonicalProfileValue, DirectoryProfileField, NormalizedProfileRow,
  ProfileChildField, ProfileGroupItem, ProfileLocation, ProfileMoney, ProfileRepeatedValue,
  ProfileValueSet, ValidatedProfileValues,
} from "@/lib/directory-profile-types";
import {
  validIanaTimeZone, validProfileDate, validProfileDateTime,
} from "../../scripts/addons/profile-schema.mjs";

type ValueContext = { isMediaAllowed?: (id: string) => boolean };

export class ProfileValueError extends HttpError {
  constructor(public fieldKey: string, message: string, options?: ErrorOptions) {
    super(400, message);
    if (options?.cause !== undefined) this.cause = options.cause;
  }
}

const decimalPattern = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
const itemIdPattern = /^[a-z0-9][a-z0-9._-]{0,119}$/i;
const mediaIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function constraints(field: DirectoryProfileField | ProfileChildField): Record<string, unknown> {
  return field.constraints;
}

function integerConstraint(field: DirectoryProfileField | ProfileChildField, key: string): number {
  const value = constraints(field)[key];
  if (!Number.isSafeInteger(value)) throw new Error(`Invalid ${field.key} ${key} constraint`);
  return value as number;
}

function stringConstraint(field: DirectoryProfileField | ProfileChildField, key: string): string {
  const value = constraints(field)[key];
  if (typeof value !== "string") throw new Error(`Invalid ${field.key} ${key} constraint`);
  return value;
}

function safeUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && Boolean(url.hostname) &&
      !url.username && !url.password;
  } catch {
    return false;
  }
}

function safeMarkdown(value: string): boolean {
  return !/<\s*\/?\s*[a-z!][^>]*>/i.test(value) &&
    !/\]\(\s*(?:javascript|data|vbscript):/i.test(value) && !value.includes("\0");
}

function strictValueObject(input: unknown, allowed: readonly string[], label: string):
Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(`${label} must be an object`);
  }
  const value = input as Record<string, unknown>;
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown) throw new Error(`${label} has unknown property ${unknown}`);
  return value;
}

function scaledDecimal(value: unknown, scale: number): number {
  if (typeof value !== "string" || !decimalPattern.test(value)) {
    throw new Error("Decimal value must be a canonical string");
  }
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole, fraction = ""] = unsigned.split(".");
  if (fraction.length > scale) throw new Error("Decimal value exceeds declared scale");
  const magnitude = BigInt(whole) * (BigInt(10) ** BigInt(scale)) +
    BigInt((fraction + "0".repeat(scale)).slice(0, scale) || "0");
  const result = negative ? -magnitude : magnitude;
  if (result > BigInt(Number.MAX_SAFE_INTEGER) || result < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new Error("Decimal value exceeds safe storage");
  }
  return Number(result);
}

function decimalString(value: number, scale: number): string {
  const negative = value < 0;
  const digits = String(Math.abs(value)).padStart(scale + 1, "0");
  const whole = scale ? digits.slice(0, -scale) : digits;
  const fraction = scale ? `.${digits.slice(-scale)}` : "";
  return `${negative ? "-" : ""}${whole}${fraction}`;
}

function choices(field: DirectoryProfileField | ProfileChildField): { value: string; label: string }[] {
  const value = constraints(field).choices;
  if (!Array.isArray(value)) throw new Error(`Invalid choices for ${field.key}`);
  return value as { value: string; label: string }[];
}

function validateScalar(field: DirectoryProfileField | ProfileChildField, input: unknown,
  context: ValueContext): CanonicalProfileValue {
  if (field.type === "short-text" || field.type === "markdown") {
    if (typeof input !== "string") throw new Error(`${field.label} must be text`);
    const value = field.type === "short-text" ? input.trim().normalize("NFC") : input.normalize("NFC");
    const minimum = integerConstraint(field, "minLength");
    const maximum = integerConstraint(field, "maxLength");
    if (value.length < minimum || value.length > maximum) {
      throw new Error(`${field.label} length is outside its constraints`);
    }
    if (field.type === "short-text" && constraints(field).format === "iana-time-zone" &&
        !validIanaTimeZone(value)) throw new Error(`${field.label} must be a canonical IANA time zone`);
    if (field.type === "markdown" && !safeMarkdown(value)) {
      throw new Error(`${field.label} contains unsafe Markdown or active content`);
    }
    return value;
  }
  if (field.type === "boolean") {
    if (typeof input !== "boolean") throw new Error(`${field.label} must be boolean`);
    return input;
  }
  if (field.type === "integer") {
    if (!Number.isSafeInteger(input) || (input as number) < integerConstraint(field, "min") ||
        (input as number) > integerConstraint(field, "max")) {
      throw new Error(`${field.label} must be a safe integer within its constraints`);
    }
    return input;
  }
  if (field.type === "decimal") {
    const scale = integerConstraint(field, "scale");
    const value = scaledDecimal(input, scale);
    if (value < scaledDecimal(stringConstraint(field, "min"), scale) ||
        value > scaledDecimal(stringConstraint(field, "max"), scale)) {
      throw new Error(`${field.label} is outside its decimal constraints`);
    }
    return decimalString(value, scale);
  }
  if (field.type === "money") {
    const raw = strictValueObject(input, ["amountMinor", "currency"], field.label);
    const currency = typeof raw.currency === "string" ? raw.currency.toUpperCase() : "";
    const allowed = constraints(field).currencies as string[];
    if (!Number.isSafeInteger(raw.amountMinor) ||
        (raw.amountMinor as number) < integerConstraint(field, "minMinor") ||
        (raw.amountMinor as number) > integerConstraint(field, "maxMinor") ||
        !allowed.includes(currency)) throw new Error(`${field.label} has invalid money`);
    return { amountMinor: raw.amountMinor as number, currency } satisfies ProfileMoney;
  }
  if (field.type === "single-choice") {
    if (typeof input !== "string" || !choices(field).some(({ value }) => value === input)) {
      throw new Error(`${field.label} has an unknown choice`);
    }
    return input;
  }
  if (field.type === "multiple-choice") {
    if (!Array.isArray(input) || new Set(input).size !== input.length ||
        input.some((value) => typeof value !== "string" ||
          !choices(field).some((choice) => choice.value === value))) {
      throw new Error(`${field.label} has invalid multiple choices`);
    }
    const selected = new Set(input as string[]);
    return choices(field).map(({ value }) => value).filter((value) => selected.has(value));
  }
  if (field.type === "url") {
    if (!safeUrl(input)) throw new Error(`${field.label} must be a safe HTTP(S) URL without credentials`);
    return new URL(input).href;
  }
  if (field.type === "date") {
    if (!validProfileDate(input) || input < stringConstraint(field, "min") ||
        input > stringConstraint(field, "max")) throw new Error(`${field.label} has an invalid date`);
    return input;
  }
  if (field.type === "datetime") {
      if (!validProfileDateTime(input)) {
        throw new Error(`${field.label} must include an explicit date/time offset`);
    }
    const value = new Date(input).toISOString();
    if (value < stringConstraint(field, "min") || value > stringConstraint(field, "max")) {
      throw new Error(`${field.label} is outside its date/time constraints`);
    }
    return value;
  }
  if (field.type === "date-range") {
    const value = strictValueObject(input, ["start", "end"], field.label);
    if (!validProfileDate(value.start) || !validProfileDate(value.end) || value.start > value.end ||
        value.start < stringConstraint(field, "min") ||
        value.end > stringConstraint(field, "max")) {
      throw new Error(`${field.label} start and end form an invalid range`);
    }
    return { start: value.start, end: value.end };
  }
  if (field.type === "duration") {
    if (!Number.isSafeInteger(input) || (input as number) < integerConstraint(field, "minSeconds") ||
        (input as number) > integerConstraint(field, "maxSeconds")) {
      throw new Error(`${field.label} has an invalid duration`);
    }
    return input;
  }
  if (field.type === "location") {
    const raw = strictValueObject(input,
      ["countryCode", "region", "locality", "latitude", "longitude"], field.label);
    const countryCode = typeof raw.countryCode === "string" ? raw.countryCode.toUpperCase() : "";
    const allowed = constraints(field).countries as string[];
    const region = typeof raw.region === "string" ? raw.region.trim().normalize("NFC") : undefined;
    const locality = typeof raw.locality === "string" ? raw.locality.trim().normalize("NFC") : undefined;
    const hasLatitude = raw.latitude !== undefined;
    const hasLongitude = raw.longitude !== undefined;
    if (!allowed.includes(countryCode) || (region?.length ?? 0) > 120 ||
        (locality?.length ?? 0) > 120 || hasLatitude !== hasLongitude ||
        (hasLatitude && (typeof raw.latitude !== "number" || !Number.isFinite(raw.latitude) ||
          raw.latitude < -90 || raw.latitude > 90 || typeof raw.longitude !== "number" ||
          !Number.isFinite(raw.longitude) || raw.longitude < -180 || raw.longitude > 180))) {
      throw new Error(`${field.label} has an invalid structured location`);
    }
    return {
      countryCode,
      ...(region ? { region } : {}),
      ...(locality ? { locality } : {}),
      ...(hasLatitude ? { latitude: Math.round((raw.latitude as number) * 1_000_000) / 1_000_000,
        longitude: Math.round((raw.longitude as number) * 1_000_000) / 1_000_000 } : {}),
    } satisfies ProfileLocation;
  }
  if (field.type === "media") {
    if (typeof input !== "string" || !mediaIdPattern.test(input) ||
        (context.isMediaAllowed && !context.isMediaAllowed(input))) {
      throw new Error(`${field.label} references unavailable media`);
    }
    return input.toLowerCase();
  }
  if (field.type === "group") {
    if (!Array.isArray(input)) throw new Error(`${field.label} must be a repeatable group`);
    const groupConstraints = constraints(field);
    const minimum = groupConstraints.minItems as number;
    const maximum = groupConstraints.maxItems as number;
    if (input.length < minimum || input.length > maximum) {
      throw new Error(`${field.label} has too many or too few group items`);
    }
    const children = groupConstraints.children as ProfileChildField[];
    const ids = new Set<string>();
    return input.map((entry, index) => {
      const raw = strictValueObject(entry, ["id", "values"], `${field.label} item ${index + 1}`);
      if (typeof raw.id !== "string" || !itemIdPattern.test(raw.id) || ids.has(raw.id) ||
          !raw.values || typeof raw.values !== "object" || Array.isArray(raw.values)) {
        throw new Error(`${field.label} item identity is invalid or duplicate`);
      }
      ids.add(raw.id);
      const source = raw.values as Record<string, unknown>;
      const unknown = Object.keys(source).find((key) => !children.some((child) => child.key === key));
      if (unknown) throw new Error(`${field.label} item has unknown child ${unknown}`);
      const values: Record<string, unknown> = {};
      for (const child of children) {
        const childInput = source[child.key];
        if (childInput === undefined || childInput === null || childInput === "") {
          if (child.required) throw new Error(`${field.label} requires ${child.label}`);
          continue;
        }
        values[child.key] = validateScalar(child, childInput, context);
      }
      return { id: raw.id, values } satisfies ProfileGroupItem;
    });
  }
  throw new Error(`Unsupported profile field type: ${field.type}`);
}

export function validateProfileFieldValue(field: DirectoryProfileField,
  input: unknown, context: ValueContext = {}): CanonicalProfileValue {
  if (input === undefined) {
    if (field.required) throw new Error(`${field.label} is required`);
    return undefined;
  }
  if (field.cardinality === "many" && !["multiple-choice", "group"].includes(field.type)) {
    const maximum = field.type === "media" ? integerConstraint(field, "maxItems") : 25;
    if (!Array.isArray(input) || input.length > maximum) {
      throw new Error(`${field.label} must be a bounded repeated value`);
    }
    const ids = new Set<string>();
    return input.map((entry, index) => {
      const raw = strictValueObject(entry, ["id", "value"],
        `${field.label} repeated item ${index + 1}`);
      if (typeof raw.id !== "string" || !itemIdPattern.test(raw.id) || ids.has(raw.id)) {
        throw new Error(`${field.label} repeated item identity is invalid or duplicate`);
      }
      ids.add(raw.id);
      return { id: raw.id, value: validateScalar(field, raw.value, context) } satisfies ProfileRepeatedValue;
    });
  }
  return validateScalar(field, input, context);
}

function emptyRow(itemId: string, childKey: string, position: number,
  valueType: NormalizedProfileRow["valueType"]): NormalizedProfileRow {
  return {
    itemId, childKey, position, valueType, textValue: null, integerValue: null,
    realValue: null, currency: null, dateStart: null, dateEnd: null,
    countryCode: null, region: null, locality: null, latitudeE6: null,
    longitudeE6: null, mediaId: null,
  };
}

function encodeScalar(field: DirectoryProfileField | ProfileChildField,
  value: unknown, itemId: string, childKey: string, position: number): NormalizedProfileRow {
  if (field.type === "group") throw new Error("Nested groups cannot be encoded");
  const row = emptyRow(itemId, childKey, position, field.type);
  if (["short-text", "markdown", "single-choice", "multiple-choice", "url"].includes(field.type)) {
    row.textValue = value as string;
  } else if (field.type === "boolean") row.integerValue = Number(value);
  else if (field.type === "integer" || field.type === "duration") row.integerValue = value as number;
  else if (field.type === "decimal") {
    row.integerValue = scaledDecimal(value, integerConstraint(field, "scale"));
  } else if (field.type === "money") {
    row.integerValue = (value as ProfileMoney).amountMinor;
    row.currency = (value as ProfileMoney).currency;
  } else if (field.type === "date" || field.type === "datetime") row.dateStart = value as string;
  else if (field.type === "date-range") {
    row.dateStart = (value as { start: string }).start;
    row.dateEnd = (value as { end: string }).end;
  } else if (field.type === "location") {
    const location = value as ProfileLocation;
    row.countryCode = location.countryCode;
    row.region = location.region ?? null;
    row.locality = location.locality ?? null;
    row.latitudeE6 = location.latitude === undefined ? null : Math.round(location.latitude * 1_000_000);
    row.longitudeE6 = location.longitude === undefined ? null : Math.round(location.longitude * 1_000_000);
  } else if (field.type === "media") row.mediaId = value as string;
  return row;
}

export function encodeProfileValue(field: DirectoryProfileField,
  value: CanonicalProfileValue): NormalizedProfileRow[] {
  if (value === undefined) return [];
  if (field.type === "multiple-choice") {
    return (value as string[]).map((choice, index) =>
      encodeScalar(field, choice, choice, "", index));
  }
  if (field.type === "group") {
    const children = constraints(field).children as ProfileChildField[];
    return (value as ProfileGroupItem[]).flatMap((item, position) => children
      .filter((child) => Object.hasOwn(item.values, child.key))
      .map((child) => encodeScalar(child, item.values[child.key], item.id, child.key, position)));
  }
  if (field.cardinality === "many") {
    return (value as ProfileRepeatedValue[]).map((item, position) =>
      encodeScalar(field, item.value, item.id, "", position));
  }
  return [encodeScalar(field, value, "value", "", 0)];
}

function decodeScalar(field: DirectoryProfileField | ProfileChildField,
  row: NormalizedProfileRow): unknown {
  if (["short-text", "markdown", "single-choice", "multiple-choice", "url"].includes(field.type)) {
    return row.textValue;
  }
  if (field.type === "boolean") return Boolean(row.integerValue);
  if (field.type === "integer" || field.type === "duration") return row.integerValue;
  if (field.type === "decimal") return decimalString(row.integerValue!, integerConstraint(field, "scale"));
  if (field.type === "money") return { amountMinor: row.integerValue!, currency: row.currency! };
  if (field.type === "date" || field.type === "datetime") return row.dateStart;
  if (field.type === "date-range") return { start: row.dateStart!, end: row.dateEnd! };
  if (field.type === "location") return {
    countryCode: row.countryCode!,
    ...(row.region ? { region: row.region } : {}),
    ...(row.locality ? { locality: row.locality } : {}),
    ...(row.latitudeE6 === null ? {} : { latitude: row.latitudeE6 / 1_000_000,
      longitude: row.longitudeE6! / 1_000_000 }),
  };
  if (field.type === "media") return row.mediaId;
  throw new Error(`Unsupported normalized value type: ${field.type}`);
}

export function decodeProfileValue(field: DirectoryProfileField,
  rows: NormalizedProfileRow[]): CanonicalProfileValue {
  const ordered = [...rows].sort((left, right) => left.position - right.position ||
    left.itemId.localeCompare(right.itemId) || left.childKey.localeCompare(right.childKey));
  if (field.type === "multiple-choice") return ordered.map((row) => row.textValue!);
  if (field.type === "group") {
    const children = constraints(field).children as ProfileChildField[];
    const items = new Map<string, ProfileGroupItem>();
    for (const row of ordered) {
      const item = items.get(row.itemId) ?? { id: row.itemId, values: {} };
      const child = children.find(({ key }) => key === row.childKey);
      if (!child) throw new Error(`Unknown stored group child: ${row.childKey}`);
      item.values[child.key] = decodeScalar(child, row);
      items.set(row.itemId, item);
    }
    return [...items.values()];
  }
  if (field.cardinality === "many") {
    return ordered.map((row) => ({ id: row.itemId, value: decodeScalar(field, row) }));
  }
  return ordered.length ? decodeScalar(field, ordered[0]) : undefined;
}

type StoredValueRow = {
  item_id: string; child_key: string; position: number;
  value_type: NormalizedProfileRow["valueType"];
  text_value: string | null; integer_value: number | null; real_value: number | null;
  currency: string | null; date_start: string | null; date_end: string | null;
  country_code: string | null; region: string | null; locality: string | null;
  latitude_e6: number | null; longitude_e6: number | null; media_id: string | null;
};

type HydratedValueRow = StoredValueRow & {
  listing_slug: string;
  profile_id: string;
  definition_version: string;
  field_key: string;
  archived_at: string | null;
};

function writable(authority: "operator" | "owner" | "system",
  field: DirectoryProfileField): boolean {
  if (authority === "system") return true;
  if (authority === "operator") return field.writeAuthority !== "system";
  return field.writeAuthority === "owner";
}

function profileFields(profiles: ActiveProfileSet): Map<string, DirectoryProfileField> {
  return new Map(profiles.definitions.flatMap((definition) =>
    definition.fields.map((field) => [field.key, field] as const)));
}

function rawProfileFieldValue(supplied: ProfileValueSet, field: DirectoryProfileField,
  authority: "operator" | "owner" | "system", applyDefaults: boolean): unknown {
  const suppliedField = Object.hasOwn(supplied, field.key);
  if (suppliedField && !writable(authority, field)) {
    throw new ProfileValueError(field.key,
      `Profile field ${field.key} is outside ${authority} write authority`);
  }
  if (suppliedField && supplied[field.key] !== undefined) return supplied[field.key];
  return applyDefaults ? field.default : undefined;
}

function mediaAllowed(field: DirectoryProfileField, listingSlug: string | undefined,
  actorUserId: string | undefined, authority: "operator" | "owner" | "system", id: string): boolean {
  if (!listingSlug || !actorUserId) return false;
  const row = database.prepare(`SELECT uploaded_by FROM directory_profile_media
    WHERE asset_id = ? AND listing_slug = ? AND field_key = ? AND state IN ('draft', 'public')`)
    .get(id, listingSlug, field.key) as { uploaded_by: string } | undefined;
  return Boolean(row && (authority !== "owner" || row.uploaded_by === actorUserId));
}

export function validateProfileValues(input: unknown, options: {
  profiles: ActiveProfileSet;
  authority: "operator" | "owner" | "system";
  listingSlug?: string;
  actorUserId?: string;
  requireComplete: boolean;
  applyDefaults?: boolean;
}): ValidatedProfileValues {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ProfileValueError("_profile", "Profile values must be an object");
  }
  const supplied = input as ProfileValueSet;
  const fields = profileFields(options.profiles);
  const unknown = Object.keys(supplied).find((key) => !fields.has(key));
  if (unknown) throw new ProfileValueError(unknown, `Unknown profile field: ${unknown}`);
  const result: ProfileValueSet = {};
  for (const field of fields.values()) {
    const raw = rawProfileFieldValue(supplied, field, options.authority,
      options.applyDefaults !== false);
    if (raw === undefined) {
      if (options.requireComplete && field.required) {
        throw new ProfileValueError(field.key, `Profile field ${field.key} is required`);
      }
      continue;
    }
    try {
      const value = validateProfileFieldValue(field, raw, {
        isMediaAllowed: (id) => mediaAllowed(field, options.listingSlug,
          options.actorUserId, options.authority, id),
      });
      if (value !== undefined) result[field.key] = value;
    } catch (error) {
      const message = error instanceof Error ? error.message : "invalid value";
      throw new ProfileValueError(field.key, `Profile field ${field.key}: ${message}`, { cause: error });
    }
  }
  return result as ValidatedProfileValues;
}

function insertStoredValue(listingSlug: string, profileId: string, version: string,
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

export function replaceListingProfileValues(input: {
  listingSlug: string;
  values: ValidatedProfileValues;
  profiles: ActiveProfileSet;
}): void {
  const now = new Date().toISOString();
  const fields = profileFields(input.profiles);
  for (const definition of input.profiles.definitions) {
    database.prepare(`DELETE FROM directory_profile_values
      WHERE listing_slug = ? AND profile_id = ? AND definition_version = ?
        AND archived_at IS NULL`).run(input.listingSlug, definition.id, definition.version);
  }
  for (const [fieldKey, value] of Object.entries(input.values)) {
    const field = fields.get(fieldKey);
    if (!field) throw new Error(`Unknown validated profile field: ${fieldKey}`);
    const definition = input.profiles.definitions.find(({ fields: candidates }) =>
      candidates.some(({ key }) => key === fieldKey));
    if (!definition) throw new Error(`Stored profile definition is missing for ${fieldKey}`);
    for (const row of encodeProfileValue(field, value)) {
      insertStoredValue(input.listingSlug, definition.id, definition.version, fieldKey, row, now);
    }
  }
  reindexProfileSearch(input.listingSlug, input.profiles);
}

function storedDefinitionMap(rows: { profile_id: string; version: string;
  definition_json: string }[]): Map<string, { fields: DirectoryProfileField[] }> {
  return new Map(rows.map((row) => [`${row.profile_id}\0${row.version}`,
    JSON.parse(row.definition_json) as { fields: DirectoryProfileField[] }]));
}

export function profileValuesForListings(slugs: readonly string[], options: {
  includePrivate?: boolean;
  includeArchived?: boolean;
} = {}): Map<string, ProfileValueSet> {
  const unique = [...new Set(slugs.filter(Boolean))];
  const result = new Map(unique.map((slug) => [slug, {} as ProfileValueSet]));
  if (!unique.length) return result;
  const placeholders = unique.map(() => "?").join(", ");
  const active = database.prepare(`SELECT base_profile_id, base_profile_version,
      site_profile_id, site_profile_version FROM directory_profile_state WHERE id = 1`).get() as {
        base_profile_id: string | null; base_profile_version: string | null;
        site_profile_id: string | null; site_profile_version: string | null;
      };
  const activePairs = [[active.base_profile_id, active.base_profile_version],
    [active.site_profile_id, active.site_profile_version]].filter(([id, version]) => id && version);
  const activeWhere = activePairs.length ? activePairs.map(() =>
    "(profile_id = ? AND definition_version = ?)").join(" OR ") : "0";
  const activeArgs = activePairs.flat() as string[];
  const rows = database.prepare(`SELECT listing_slug, profile_id, definition_version,
      field_key, item_id, child_key, position, value_type, text_value, integer_value,
      real_value, currency, date_start, date_end, country_code, region, locality,
      latitude_e6, longitude_e6, media_id, archived_at
    FROM directory_profile_values WHERE listing_slug IN (${placeholders}) AND
      (${options.includeArchived ? `archived_at IS NOT NULL OR
        (archived_at IS NULL AND (${activeWhere}))` : `archived_at IS NULL AND (${activeWhere})`})
    ORDER BY archived_at IS NULL, updated_at, position, item_id, child_key`)
    .all(...unique, ...activeArgs) as HydratedValueRow[];
  if (!rows.length) return result;
  const pairs = [...new Set(rows.map((row) => `${row.profile_id}\0${row.definition_version}`))]
    .map((pair) => pair.split("\0"));
  const pairWhere = pairs.map(() => "(profile_id = ? AND version = ?)").join(" OR ");
  const definitions = storedDefinitionMap(database.prepare(`SELECT profile_id, version, definition_json
    FROM directory_profile_definitions WHERE ${pairWhere}`).all(...pairs.flat()) as {
      profile_id: string; version: string; definition_json: string;
    }[]);
  const groups = new Map<string, HydratedValueRow[]>();
  for (const row of rows) {
    const key = [row.listing_slug, row.profile_id, row.definition_version, row.field_key,
      row.archived_at ? "archived" : "active"].join("\0");
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  for (const [key, group] of groups) {
    const [listingSlug, profileId, version, fieldKey] = key.split("\0");
    const definition = definitions.get(`${profileId}\0${version}`);
    const field = definition?.fields.find(({ key: candidate }) => candidate === fieldKey);
    if (!field || (options.includePrivate === false && field.visibility !== "public")) continue;
    result.get(listingSlug)![fieldKey] = decodeProfileValue(field, group.map(normalizedRow));
  }
  return result;
}

export function assertListingProfilePublishable(listingSlug: string): void {
  const state = database.prepare(`SELECT revision FROM directory_profile_state WHERE id = 1`).get() as
    { revision: number };
  const definitionRows = database.prepare(`SELECT definition_json FROM directory_profile_definitions d
    JOIN directory_profile_state s ON s.id = 1
    WHERE (d.profile_id = s.base_profile_id AND d.version = s.base_profile_version)
       OR (d.profile_id = s.site_profile_id AND d.version = s.site_profile_version)`).all() as
    { definition_json: string }[];
  const profiles: ActiveProfileSet = { state: { revision: state.revision, base: null, site: null },
    definitions: definitionRows.map(({ definition_json }) =>
      JSON.parse(definition_json) as ActiveProfileSet["definitions"][number]) };
  const values = profileValuesForListings([listingSlug], { includePrivate: true }).get(listingSlug) ?? {};
  validateProfileValues(values, { profiles, authority: "system", listingSlug,
    actorUserId: "system", requireComplete: true });
}

function normalizedRow(row: StoredValueRow): NormalizedProfileRow {
  return {
    itemId: row.item_id, childKey: row.child_key, position: row.position,
    valueType: row.value_type, textValue: row.text_value, integerValue: row.integer_value,
    realValue: row.real_value, currency: row.currency, dateStart: row.date_start,
    dateEnd: row.date_end, countryCode: row.country_code, region: row.region,
    locality: row.locality, latitudeE6: row.latitude_e6, longitudeE6: row.longitude_e6,
    mediaId: row.media_id,
  };
}

export function reindexProfileSearch(listingSlug: string, profiles: ActiveProfileSet): void {
  database.prepare("DELETE FROM directory_profile_search WHERE listing_slug = ?").run(listingSlug);
  const insert = database.prepare(`INSERT INTO directory_profile_search
    (listing_slug, profile_id, field_key, value) VALUES (?, ?, ?, ?)`);
  for (const definition of profiles.definitions) {
    for (const field of definition.fields.filter((candidate) =>
      candidate.visibility === "public" && candidate.searchable)) {
      const rows = database.prepare(`SELECT item_id, child_key, position, value_type,
          text_value, integer_value, real_value, currency, date_start, date_end,
          country_code, region, locality, latitude_e6, longitude_e6, media_id
        FROM directory_profile_values
        WHERE listing_slug = ? AND profile_id = ? AND definition_version = ?
          AND field_key = ? AND archived_at IS NULL
        ORDER BY position, item_id, child_key`).all(
          listingSlug, definition.id, definition.version, field.key) as
        StoredValueRow[];
      if (!rows.length) continue;
      const decoded = decodeProfileValue(field, rows.map(normalizedRow));
      const text = typeof decoded === "string" ? decoded : JSON.stringify(decoded);
      insert.run(listingSlug, definition.id, field.key, text);
    }
  }
}
