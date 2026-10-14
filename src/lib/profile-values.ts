import { database } from "@/lib/database";
import type {
  ActiveProfileSet, CanonicalProfileValue, DirectoryProfileField, NormalizedProfileRow,
  ProfileChildField, ProfileGroupItem, ProfileLocation, ProfileMoney, ProfileRepeatedValue,
} from "@/lib/directory-profile-types";

type ValueContext = { isMediaAllowed?: (id: string) => boolean };

const decimalPattern = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
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

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !datePattern.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
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
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new Error(`${field.label} must contain amountMinor and currency`);
    }
    const raw = input as Record<string, unknown>;
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
    if (!validDate(input) || input < stringConstraint(field, "min") ||
        input > stringConstraint(field, "max")) throw new Error(`${field.label} has an invalid date`);
    return input;
  }
  if (field.type === "datetime") {
    if (typeof input !== "string" || Number.isNaN(Date.parse(input))) {
      throw new Error(`${field.label} has an invalid date/time`);
    }
    const value = new Date(input).toISOString();
    if (value < stringConstraint(field, "min") || value > stringConstraint(field, "max")) {
      throw new Error(`${field.label} is outside its date/time constraints`);
    }
    return value;
  }
  if (field.type === "date-range") {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new Error(`${field.label} must be a date range`);
    }
    const value = input as Record<string, unknown>;
    if (!validDate(value.start) || !validDate(value.end) || value.start > value.end ||
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
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new Error(`${field.label} must be a structured location`);
    }
    const raw = input as Record<string, unknown>;
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
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        throw new Error(`${field.label} item ${index + 1} is invalid`);
      }
      const raw = entry as Record<string, unknown>;
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
  if (input === undefined || input === null || input === "") {
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
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        throw new Error(`${field.label} repeated item ${index + 1} is invalid`);
      }
      const raw = entry as Record<string, unknown>;
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
