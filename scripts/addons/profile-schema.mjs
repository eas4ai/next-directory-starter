import { createHash } from "node:crypto";
import semver from "semver";
import { z } from "zod";

export const PROFILE_SCHEMA_VERSION = 1;
export const PROFILE_LIMITS = Object.freeze({
  fields: 100,
  choices: 50,
  groupChildren: 20,
  groupItems: 25,
  fileBytes: 256 * 1024,
  valueBodyBytes: 256 * 1024,
  migrationRows: 100_000,
  facets: 12,
  facetValues: 20,
  facetValueBytes: 120,
  queryBytes: 4096,
});

export const PROFILE_FIELD_TYPES = Object.freeze([
  "short-text", "markdown", "boolean", "integer", "decimal", "money",
  "single-choice", "multiple-choice", "url", "date", "datetime", "date-range",
  "duration", "location", "media", "group",
]);

const namespacePattern = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;
const childKeyPattern = /^[a-z][a-z0-9-]*$/;
const choicePattern = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const itemIdPattern = /^[a-z0-9][a-z0-9._-]{0,119}$/i;
const mediaIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;
const decimalPattern = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

const displayName = z.string().trim().min(1).max(120);
const helpText = z.string().trim().min(1).max(500);
const fieldType = z.enum(PROFILE_FIELD_TYPES);
const choice = z.object({
  value: z.string().min(1).max(80).regex(choicePattern),
  label: displayName,
}).strict();
const facet = z.object({
  label: displayName,
  mode: z.enum(["any", "all"]),
}).strict();
const sort = z.object({
  label: displayName,
  directions: z.array(z.enum(["asc", "desc"])).min(1).max(2),
}).strict();

const childField = z.object({
  key: z.string().min(1).max(80).regex(childKeyPattern),
  label: displayName,
  help: helpText,
  type: fieldType.exclude(["group"]),
  required: z.boolean(),
  constraints: z.unknown(),
  default: z.unknown().optional(),
}).strict();

const profileField = z.object({
  key: z.string().min(3).max(160).regex(namespacePattern),
  label: displayName,
  help: helpText,
  type: fieldType,
  cardinality: z.enum(["one", "many"]),
  required: z.boolean(),
  writeAuthority: z.enum(["operator", "owner", "system"]),
  visibility: z.enum(["public", "staff", "private"]),
  placement: z.enum(["card", "badge", "detail", "hidden"]),
  group: z.string().trim().min(1).max(80).nullable(),
  order: z.number().int().min(0).max(10_000),
  searchable: z.boolean(),
  facet: facet.nullable(),
  sort: sort.nullable(),
  constraints: z.unknown(),
  default: z.unknown().optional(),
}).strict();

const profileSchema = z.object({
  schemaVersion: z.literal(PROFILE_SCHEMA_VERSION),
  id: z.string().min(3).max(120).regex(namespacePattern),
  version: z.string().min(1).max(40)
    .refine((value) => semver.valid(value) !== null, "Invalid semantic version"),
  name: displayName,
  description: z.string().trim().min(1).max(500),
  fields: z.array(profileField).min(1).max(PROFILE_LIMITS.fields),
}).strict();

function unique(values, label) {
  if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label}`);
}

function plainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} constraints must be an object`);
  }
  return value;
}

function strictKeys(value, allowed, label) {
  const object = plainObject(value, label);
  const unknown = Object.keys(object).find((key) => !allowed.includes(key));
  if (unknown) throw new Error(`Unknown ${label} constraint: ${unknown}`);
  return object;
}

function safeInteger(value, label) {
  if (!Number.isSafeInteger(value)) throw new Error(`${label} must be a safe integer`);
  return value;
}

function boundedPair(object, minKey, maxKey, label) {
  const minimum = safeInteger(object[minKey], `${label} ${minKey}`);
  const maximum = safeInteger(object[maxKey], `${label} ${maxKey}`);
  if (minimum > maximum) throw new Error(`${label} minimum exceeds maximum`);
}

/** @param {unknown} value @returns {value is string} */
export function validProfileDate(value) {
  if (typeof value !== "string" || !isoDatePattern.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validDateTime(value) {
  return typeof value === "string" && value.length <= 40 &&
    /^\d{4}-\d{2}-\d{2}T/.test(value) && !Number.isNaN(Date.parse(value));
}

function validateRangeStrings(object, validator, label) {
  if (!validator(object.min) || !validator(object.max) || object.min > object.max) {
    throw new Error(`Invalid ${label} range`);
  }
}

function normalizeConstraints(type, input, child = false) {
  if (type === "short-text" || type === "markdown") {
    const value = strictKeys(input, ["minLength", "maxLength"], type);
    boundedPair(value, "minLength", "maxLength", type);
    const ceiling = type === "short-text" ? 1_000 : 20_000;
    if (value.minLength < 0 || value.maxLength > ceiling) {
      throw new Error(`${type} length is unbounded`);
    }
    return { minLength: value.minLength, maxLength: value.maxLength };
  }
  if (["boolean", "url"].includes(type)) {
    strictKeys(input, [], type);
    return {};
  }
  if (type === "integer") {
    const value = strictKeys(input, ["min", "max"], type);
    boundedPair(value, "min", "max", type);
    return { min: value.min, max: value.max };
  }
  if (type === "decimal") {
    const value = strictKeys(input, ["min", "max", "scale"], type);
    if (!decimalPattern.test(value.min) || !decimalPattern.test(value.max) ||
        !Number.isInteger(value.scale) || value.scale < 0 || value.scale > 6) {
      throw new Error("Invalid decimal constraints");
    }
    const scaled = (entry) => decimalToScaled(entry, value.scale);
    if (scaled(value.min) > scaled(value.max)) throw new Error("Decimal minimum exceeds maximum");
    return { min: value.min, max: value.max, scale: value.scale };
  }
  if (type === "money") {
    const value = strictKeys(input, ["minMinor", "maxMinor", "currencies"], type);
    boundedPair(value, "minMinor", "maxMinor", type);
    if (value.minMinor < 0 || !Array.isArray(value.currencies) ||
        value.currencies.length < 1 || value.currencies.length > 20 ||
        value.currencies.some((currency) => typeof currency !== "string" ||
          !/^[A-Z]{3}$/.test(currency))) throw new Error("Invalid money currencies");
    unique(value.currencies, "money currency");
    return { minMinor: value.minMinor, maxMinor: value.maxMinor,
      currencies: [...value.currencies].sort() };
  }
  if (type === "single-choice" || type === "multiple-choice") {
    const value = strictKeys(input, ["choices"], type);
    const choices = z.array(choice).min(1).max(PROFILE_LIMITS.choices).parse(value.choices);
    unique(choices.map(({ value: choiceValue }) => choiceValue), "choice value");
    return { choices };
  }
  if (type === "date" || type === "date-range") {
    const value = strictKeys(input, ["min", "max"], type);
    validateRangeStrings(value, validProfileDate, type);
    return { min: value.min, max: value.max };
  }
  if (type === "datetime") {
    const value = strictKeys(input, ["min", "max"], type);
    validateRangeStrings(value, validDateTime, type);
    return { min: new Date(value.min).toISOString(), max: new Date(value.max).toISOString() };
  }
  if (type === "duration") {
    const value = strictKeys(input, ["minSeconds", "maxSeconds"], type);
    boundedPair(value, "minSeconds", "maxSeconds", type);
    if (value.minSeconds < 0) throw new Error("Duration cannot be negative");
    return { minSeconds: value.minSeconds, maxSeconds: value.maxSeconds };
  }
  if (type === "location") {
    const value = strictKeys(input, ["countries"], type);
    if (!Array.isArray(value.countries) || value.countries.length < 1 ||
        value.countries.length > 250 ||
        value.countries.some((country) => typeof country !== "string" ||
          !/^[A-Z]{2}$/.test(country))) throw new Error("Invalid location countries");
    unique(value.countries, "location country");
    return { countries: [...value.countries].sort() };
  }
  if (type === "media") {
    const value = strictKeys(input, ["maxItems"], type);
    if (!Number.isInteger(value.maxItems) || value.maxItems < 1 ||
        value.maxItems > PROFILE_LIMITS.groupItems) throw new Error("Media maxItems must be bounded at 25");
    return { maxItems: value.maxItems };
  }
  if (type === "group") {
    if (child) throw new Error("Repeatable groups cannot be nested");
    const value = strictKeys(input, ["minItems", "maxItems", "children"], type);
    boundedPair(value, "minItems", "maxItems", type);
    if (value.minItems < 0 || value.maxItems > PROFILE_LIMITS.groupItems) {
      throw new Error("Repeatable group maxItems must be bounded at 25");
    }
    const children = z.array(childField).min(1).max(PROFILE_LIMITS.groupChildren)
      .parse(value.children).map((field) => ({
        ...field,
        constraints: normalizeConstraints(field.type, field.constraints, true),
      }));
    unique(children.map(({ key }) => key), "group child key");
    for (const field of children) validateDefault(field);
    return { minItems: value.minItems, maxItems: value.maxItems, children };
  }
  throw new Error(`Unknown profile field type: ${type}`);
}

function safeUrl(value) {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && Boolean(url.hostname) &&
      !url.username && !url.password;
  } catch {
    return false;
  }
}

function safeMarkdown(value) {
  return typeof value === "string" && !/<\s*\/?\s*[a-z!][^>]*>/i.test(value) &&
    !/\]\(\s*(?:javascript|data|vbscript):/i.test(value) && !value.includes("\0");
}

function decimalToScaled(value, scale) {
  if (typeof value !== "string" || !decimalPattern.test(value)) throw new Error("Invalid decimal value");
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole, fraction = ""] = unsigned.split(".");
  if (fraction.length > scale) throw new Error("Decimal value exceeds declared scale");
  const result = BigInt(whole) * (BigInt(10) ** BigInt(scale)) +
    BigInt((fraction + "0".repeat(scale)).slice(0, scale) || "0");
  const signed = negative ? -result : result;
  if (signed > BigInt(Number.MAX_SAFE_INTEGER) || signed < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new Error("Decimal value exceeds safe storage");
  }
  return Number(signed);
}

function decimalFromScaled(value, scale) {
  const negative = value < 0;
  const digits = String(Math.abs(value)).padStart(scale + 1, "0");
  const whole = scale ? digits.slice(0, -scale) : digits;
  const fraction = scale ? `.${digits.slice(-scale)}` : "";
  return `${negative ? "-" : ""}${whole}${fraction}`;
}

function valueObject(value, allowed, label) {
  const object = plainObject(value, label);
  const unknown = Object.keys(object).find((key) => !allowed.includes(key));
  if (unknown) throw new Error(`Unknown ${label} property: ${unknown}`);
  return object;
}

function normalizeScalarDefault(field, value) {
  const { type, constraints } = field;
  if (type === "short-text" || type === "markdown") {
    if (typeof value !== "string") throw new Error(`Invalid ${type} default`);
    const normalized = type === "short-text" ? value.trim().normalize("NFC") : value.normalize("NFC");
    if (normalized.length < constraints.minLength || normalized.length > constraints.maxLength ||
        (type === "markdown" && !safeMarkdown(normalized))) {
      throw new Error(`Invalid ${type} default`);
    }
    return normalized;
  }
  if (type === "boolean") {
    if (typeof value !== "boolean") throw new Error("Invalid boolean default");
    return value;
  }
  if (type === "integer") {
    if (!Number.isSafeInteger(value) || value < constraints.min || value > constraints.max) {
      throw new Error("Invalid integer default");
    }
    return value;
  }
  if (type === "decimal") {
    const scaled = decimalToScaled(value, constraints.scale);
    if (scaled < decimalToScaled(constraints.min, constraints.scale) ||
        scaled > decimalToScaled(constraints.max, constraints.scale)) {
      throw new Error("Invalid decimal default");
    }
    return decimalFromScaled(scaled, constraints.scale);
  }
  if (type === "money") {
    const object = valueObject(value, ["amountMinor", "currency"], "money default");
    const currency = typeof object.currency === "string" ? object.currency.toUpperCase() : "";
    if (!Number.isSafeInteger(object.amountMinor) || object.amountMinor < constraints.minMinor ||
        object.amountMinor > constraints.maxMinor || !constraints.currencies.includes(currency)) {
      throw new Error("Invalid money default");
    }
    return { amountMinor: object.amountMinor, currency };
  }
  if (type === "single-choice") {
    if (typeof value !== "string" || !constraints.choices.some((choiceValue) =>
      choiceValue.value === value)) throw new Error("Invalid choice default");
    return value;
  }
  if (type === "multiple-choice") {
    if (!Array.isArray(value) || new Set(value).size !== value.length ||
        value.some((entry) => typeof entry !== "string" ||
          !constraints.choices.some((choiceValue) => choiceValue.value === entry))) {
      throw new Error("Invalid multiple-choice default");
    }
    const selected = new Set(value);
    return constraints.choices.map(({ value: choiceValue }) => choiceValue)
      .filter((choiceValue) => selected.has(choiceValue));
  }
  if (type === "url") {
    if (!safeUrl(value)) throw new Error("Invalid URL default");
    return new URL(value).href;
  }
  if (type === "date") {
    if (!validProfileDate(value) || value < constraints.min || value > constraints.max) {
      throw new Error("Invalid date default");
    }
    return value;
  }
  if (type === "datetime") {
    if (!validDateTime(value)) throw new Error("Invalid datetime default");
    const normalized = new Date(value).toISOString();
    if (normalized < constraints.min || normalized > constraints.max) {
      throw new Error("Invalid datetime default");
    }
    return normalized;
  }
  if (type === "date-range") {
    const object = valueObject(value, ["start", "end"], "date-range default");
    if (!validProfileDate(object.start) || !validProfileDate(object.end) || object.start > object.end ||
        object.start < constraints.min || object.end > constraints.max) {
      throw new Error("Invalid date-range default");
    }
    return { start: object.start, end: object.end };
  }
  if (type === "duration") {
    if (!Number.isSafeInteger(value) || value < constraints.minSeconds ||
        value > constraints.maxSeconds) throw new Error("Invalid duration default");
    return value;
  }
  if (type === "location") {
    const object = valueObject(value, ["countryCode", "region", "locality", "latitude", "longitude"],
      "location default");
    const countryCode = typeof object.countryCode === "string" ? object.countryCode.toUpperCase() : "";
    const region = typeof object.region === "string" ? object.region.trim().normalize("NFC") : undefined;
    const locality = typeof object.locality === "string" ? object.locality.trim().normalize("NFC") : undefined;
    const hasLatitude = object.latitude !== undefined;
    const hasLongitude = object.longitude !== undefined;
    if (!constraints.countries.includes(countryCode) || (region?.length ?? 0) > 120 ||
        (locality?.length ?? 0) > 120 || hasLatitude !== hasLongitude ||
        (hasLatitude && (typeof object.latitude !== "number" || !Number.isFinite(object.latitude) ||
          object.latitude < -90 || object.latitude > 90 || typeof object.longitude !== "number" ||
          !Number.isFinite(object.longitude) || object.longitude < -180 || object.longitude > 180))) {
      throw new Error("Invalid location default");
    }
    return { countryCode, ...(region ? { region } : {}), ...(locality ? { locality } : {}),
      ...(hasLatitude ? { latitude: Math.round(object.latitude * 1_000_000) / 1_000_000,
        longitude: Math.round(object.longitude * 1_000_000) / 1_000_000 } : {}) };
  }
  if (type === "media") {
    if (typeof value !== "string" || !mediaIdPattern.test(value)) {
      throw new Error("Invalid media default");
    }
    return value.toLowerCase();
  }
  if (type === "group") {
    if (!Array.isArray(value) || value.length < constraints.minItems ||
        value.length > constraints.maxItems) throw new Error("Invalid group default");
    const ids = new Set();
    return value.map((entry, index) => {
      const item = valueObject(entry, ["id", "values"], `group default item ${index + 1}`);
      if (typeof item.id !== "string" || !itemIdPattern.test(item.id) || ids.has(item.id)) {
        throw new Error("Invalid or duplicate group default item identity");
      }
      ids.add(item.id);
      const supplied = valueObject(item.values, constraints.children.map(({ key }) => key),
        `group default item ${item.id}`);
      const values = {};
      for (const child of constraints.children) {
        const childValue = supplied[child.key] ?? child.default;
        if (childValue === undefined) {
          if (child.required) throw new Error(`Group default requires ${child.label}`);
          continue;
        }
        values[child.key] = normalizeScalarDefault(child, childValue);
      }
      return { id: item.id, values };
    });
  }
  throw new Error(`Unsupported default type: ${type}`);
}

function validateDefault(field) {
  if (!("default" in field)) return;
  if (field.cardinality === "many" && !["multiple-choice", "group"].includes(field.type)) {
    const maximum = field.type === "media" ? field.constraints.maxItems : PROFILE_LIMITS.groupItems;
    if (!Array.isArray(field.default) || field.default.length > maximum) {
      throw new Error(`Invalid ${field.type} multiple default`);
    }
    const ids = new Set();
    field.default = field.default.map((entry) => {
      const item = valueObject(entry, ["id", "value"], `${field.type} multiple default item`);
      if (typeof item.id !== "string" || !itemIdPattern.test(item.id) || ids.has(item.id)) {
        throw new Error(`Invalid or duplicate ${field.type} multiple default item identity`);
      }
      ids.add(item.id);
      return { id: item.id, value: normalizeScalarDefault(field, item.value) };
    });
    return;
  }
  field.default = normalizeScalarDefault(field, field.default);
}

function validateProfileRelationships(profile) {
  unique(profile.fields.map(({ key }) => key), "field key");
  let facets = 0;
  for (const field of profile.fields) {
    if (!field.key.startsWith(`${profile.id}.`) &&
        !(profile.id === "site.local" && field.key.startsWith("site."))) {
      throw new Error(`Field key is outside profile namespace: ${field.key}`);
    }
    field.constraints = normalizeConstraints(field.type, field.constraints);
    if (field.type === "single-choice" && field.cardinality !== "one") {
      throw new Error("Single-choice fields require one cardinality");
    }
    if (["multiple-choice", "group"].includes(field.type) && field.cardinality !== "many") {
      throw new Error(`${field.type} fields require many cardinality`);
    }
    if (field.visibility !== "public" &&
        (field.searchable || field.facet || field.sort || field.placement !== "hidden")) {
      throw new Error(`Non-public field visibility contradicts public discovery: ${field.key}`);
    }
    if (field.searchable && !["short-text", "markdown"].includes(field.type)) {
      throw new Error(`Field type cannot be searchable: ${field.key}`);
    }
    if (field.facet) {
      facets += 1;
      if (!["boolean", "integer", "decimal", "money", "single-choice", "multiple-choice",
        "date", "datetime", "date-range", "duration", "location"].includes(field.type)) {
        throw new Error(`Field type cannot be a facet: ${field.key}`);
      }
    }
    if (field.sort && (field.cardinality !== "one" ||
        !["short-text", "integer", "decimal", "money", "date", "datetime", "duration"]
          .includes(field.type))) {
      throw new Error(`Field type or cardinality cannot be sorted: ${field.key}`);
    }
    if (field.sort) unique(field.sort.directions, `sort direction for ${field.key}`);
    validateDefault(field);
  }
  if (facets > PROFILE_LIMITS.facets) throw new Error("Profile declares too many facets");
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort()
      .map((key) => [key, canonical(value[key])]));
  }
  return value;
}

export function parseDirectoryProfileDefinition(input) {
  const parsed = profileSchema.parse(input);
  validateProfileRelationships(parsed);
  return parsed;
}

export function canonicalProfileJson(input) {
  return `${JSON.stringify(canonical(parseDirectoryProfileDefinition(input)))}\n`;
}

export function profileDigest(input) {
  return createHash("sha256").update(canonicalProfileJson(input)).digest("hex");
}
