import { database } from "@/lib/database";
import { activeDirectoryProfiles } from "@/lib/directory-profiles";
import type {
  ActiveProfileSet, DirectoryProfileField,
} from "@/lib/directory-profile-types";
import {
  hydratePublicListings, LISTINGS_PER_PAGE, PUBLIC_LISTING_PREDICATE,
  type Listing, type StoredListing,
} from "@/lib/listings";
import { validateProfileFieldValue } from "@/lib/profile-values";
import { validProfileDate } from "../../scripts/addons/profile-schema.mjs";

const QUERY_BYTES = 4_096;
const FACET_LIMIT = 12;
const FACET_VALUE_LIMIT = 20;
const FACET_VALUE_BYTES = 120;
const integerPattern = /^-?(?:0|[1-9]\d*)$/;
const moneyPattern = /^([A-Z]{3}):(-?(?:0|[1-9]\d*))$/;
const explicitOffsetDateTimePattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;

type ParsedValuesFacet = { values: string[] };
type ParsedRangeFacet = { min?: string; max?: string };
export type ParsedProfileFacet = ParsedValuesFacet | ParsedRangeFacet;

export type ParsedProfileDirectoryQuery = {
  invalid: boolean;
  q: string;
  category: string;
  facets: Record<string, ParsedProfileFacet>;
  sort: { fieldKey: string; direction: "asc" | "desc" } | null;
  page: number;
  hasQuery: boolean;
  profileStateRevision: number;
};

export type ProfileFacetCounts = Record<string, Record<string, number>>;

export type ProfileDirectoryResult = {
  listings: Listing[];
  total: number;
  page: number;
  pages: number;
  facetCounts: ProfileFacetCounts;
};

export type ProfileDiscoveryDescriptor = {
  profileId: string;
  definitionVersion: string;
  field: DirectoryProfileField;
};

type DescriptorSet = {
  ordered: ProfileDiscoveryDescriptor[];
  fields: Map<string, ProfileDiscoveryDescriptor>;
};

type RawFacet = { values?: string[]; min?: string; max?: string };
type SqlArgument = string | number | null;
type SqlFragment = { sql: string; args: SqlArgument[] };

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function descriptors(profiles: ActiveProfileSet): DescriptorSet {
  const ordered = profiles.definitions.flatMap((definition) =>
    definition.fields.map((field) => ({ profileId: definition.id,
      definitionVersion: definition.version, field })));
  return { ordered, fields: new Map(ordered.map((item) => [item.field.key, item])) };
}

export function profileDiscoveryDescriptors(
  profiles: ActiveProfileSet = activeDirectoryProfiles(),
): ProfileDiscoveryDescriptor[] {
  return descriptors(profiles).ordered.filter(({ field }) =>
    field.visibility === "public" && (field.facet !== null || field.sort !== null));
}

function invalidQuery(hasQuery: boolean, profileStateRevision: number): ParsedProfileDirectoryQuery {
  return { invalid: true, q: "", category: "", facets: {}, sort: null, page: 1,
    hasQuery, profileStateRevision };
}

function scalar(input: string | string[] | undefined): string | null {
  return typeof input === "string" ? input : null;
}

function querySize(input: Record<string, string | string[] | undefined>): number | null {
  const query = new URLSearchParams();
  for (const [key, raw] of Object.entries(input)) {
    if (raw === undefined) continue;
    const values = Array.isArray(raw) ? raw : [raw];
    if (values.some((value) => typeof value !== "string")) return null;
    for (const value of values) query.append(key, value);
  }
  return byteLength(query.toString());
}

function asSafeInteger(value: string): number | null {
  if (!integerPattern.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function normalizeRangeValue(field: DirectoryProfileField, value: string): string | null {
  try {
    if (field.type === "integer" || field.type === "duration") {
      const parsed = asSafeInteger(value);
      if (parsed === null) return null;
      return String(validateProfileFieldValue(field, parsed));
    }
    if (field.type === "decimal") {
      return String(validateProfileFieldValue(field, value));
    }
    if (field.type === "money") {
      const match = moneyPattern.exec(value);
      if (!match) return null;
      const amountMinor = asSafeInteger(match[2]);
      if (amountMinor === null) return null;
      const normalized = validateProfileFieldValue(field,
        { currency: match[1], amountMinor }) as { currency: string; amountMinor: number };
      return `${normalized.currency}:${normalized.amountMinor}`;
    }
    if (field.type === "date") {
      return String(validateProfileFieldValue(field, value));
    }
    if (field.type === "datetime") {
      if (!explicitOffsetDateTimePattern.test(value)) return null;
      return String(validateProfileFieldValue(field, value));
    }
    if (field.type === "date-range") {
      if (!validProfileDate(value)) return null;
      validateProfileFieldValue(field, { start: value, end: value });
      return value;
    }
  } catch {
    return null;
  }
  return null;
}

function normalizeLocation(field: DirectoryProfileField, value: string): string | null {
  const parts = value.split("|");
  if (parts.length < 1 || parts.length > 3 || !parts[0]) return null;
  try {
    const normalized = validateProfileFieldValue(field, {
      countryCode: parts[0],
      ...(parts[1] ? { region: parts[1] } : {}),
      ...(parts[2] ? { locality: parts[2] } : {}),
    }) as { countryCode: string; region?: string; locality?: string };
    if (normalized.locality !== undefined) {
      return `${normalized.countryCode}|${normalized.region ?? ""}|${normalized.locality}`;
    }
    return normalized.region === undefined
      ? normalized.countryCode : `${normalized.countryCode}|${normalized.region}`;
  } catch {
    return null;
  }
}

function normalizeFacetValues(field: DirectoryProfileField, rawValues: string[]): string[] | null {
  if (!rawValues.length || rawValues.length > FACET_VALUE_LIMIT ||
      rawValues.some((value) => byteLength(value) > FACET_VALUE_BYTES)) return null;
  try {
    if (field.type === "multiple-choice") {
      return validateProfileFieldValue(field, [...new Set(rawValues)]) as string[];
    }
    if (field.type === "single-choice") {
      const selected = new Set(rawValues.map((value) =>
        String(validateProfileFieldValue(field, value))));
      const choices = field.constraints.choices as { value: string }[];
      return choices.map(({ value }) => value).filter((value) => selected.has(value));
    }
    if (field.type === "boolean") {
      if (rawValues.some((value) => value !== "true" && value !== "false")) return null;
      const selected = new Set(rawValues);
      return ["true", "false"].filter((value) => selected.has(value));
    }
    if (field.type === "location") {
      const normalized = rawValues.map((value) => normalizeLocation(field, value));
      if (normalized.some((value) => value === null)) return null;
      return [...new Set(normalized as string[])];
    }
  } catch {
    return null;
  }
  return null;
}

function rangeOrderValid(field: DirectoryProfileField, facet: ParsedRangeFacet): boolean {
  if (facet.min === undefined || facet.max === undefined) return true;
  if (field.type === "money") {
    const min = moneyPattern.exec(facet.min);
    const max = moneyPattern.exec(facet.max);
    return Boolean(min && max && min[1] === max[1] && Number(min[2]) <= Number(max[2]));
  }
  if (field.type === "decimal") return Number(facet.min) <= Number(facet.max);
  if (["integer", "duration"].includes(field.type)) {
    return Number(facet.min) <= Number(facet.max);
  }
  return facet.min <= facet.max;
}

function facetKey(key: string, descriptorSet: DescriptorSet):
{ operator: "facet" | "min" | "max"; fieldKey: string } | null {
  const match = /^(facet|min|max)\.(.+)$/.exec(key);
  if (!match) return null;
  const descriptor = descriptorSet.fields.get(match[2]);
  if (!descriptor || descriptor.field.visibility !== "public" || !descriptor.field.facet) return null;
  return { operator: match[1] as "facet" | "min" | "max", fieldKey: match[2] };
}

function putRawValues(rawFacets: Map<string, RawFacet>, fieldKey: string,
  raw: string | string[] | undefined): boolean {
  const values = (Array.isArray(raw) ? raw : raw === undefined ? [] : [raw])
    .filter((value) => value !== "");
  if (!values.length) return true;
  const state = rawFacets.get(fieldKey) ?? {};
  if (state.values || values.some((value) => typeof value !== "string")) return false;
  state.values = values;
  rawFacets.set(fieldKey, state);
  return rawFacets.size <= FACET_LIMIT;
}

function putRawRange(rawFacets: Map<string, RawFacet>, operator: "min" | "max", fieldKey: string,
  raw: string | string[] | undefined): boolean {
  if (raw === "") return true;
  const state = rawFacets.get(fieldKey) ?? {};
  if (Array.isArray(raw) || raw === undefined || state[operator] !== undefined) return false;
  state[operator] = raw;
  rawFacets.set(fieldKey, state);
  return rawFacets.size <= FACET_LIMIT;
}

function putRawFacet(rawFacets: Map<string, RawFacet>, parsedKey: NonNullable<ReturnType<typeof facetKey>>,
  raw: string | string[] | undefined): boolean {
  return parsedKey.operator === "facet"
    ? putRawValues(rawFacets, parsedKey.fieldKey, raw)
    : putRawRange(rawFacets, parsedKey.operator, parsedKey.fieldKey, raw);
}

function collectRawFacets(input: Record<string, string | string[] | undefined>,
  descriptorSet: DescriptorSet): Map<string, RawFacet> | null {
  const rawFacets = new Map<string, RawFacet>();
  for (const [key, raw] of Object.entries(input)) {
    if (["q", "category", "sort", "page"].includes(key)) {
      if (Array.isArray(raw)) return null;
      continue;
    }
    const parsedKey = facetKey(key, descriptorSet);
    if (!parsedKey || !putRawFacet(rawFacets, parsedKey, raw)) return null;
  }
  return rawFacets;
}

function parseSimpleQuery(input: Record<string, string | string[] | undefined>):
{ q: string; category: string; page: number } | null {
  const qInput = scalar(input.q);
  const categoryInput = scalar(input.category);
  const pageInput = scalar(input.page);
  if ((input.q !== undefined && qInput === null) ||
      (input.category !== undefined && categoryInput === null) ||
      (input.page !== undefined && pageInput === null)) return null;
  const q = (qInput ?? "").trim().normalize("NFC");
  const category = (categoryInput ?? "").trim().normalize("NFC");
  if (byteLength(q) > QUERY_BYTES || q.includes("\0") ||
      byteLength(category) > 80 || category.includes("\0")) return null;
  const page = pageInput === null || pageInput === "" ? 1
    : /^\d{1,6}$/.test(pageInput) && Number(pageInput) >= 1 ? Number(pageInput) : 0;
  return page ? { q, category, page } : null;
}

function parseSort(input: string | string[] | undefined,
  descriptorSet: DescriptorSet): ParsedProfileDirectoryQuery["sort"] | undefined {
  const sortInput = scalar(input);
  if (input !== undefined && sortInput === null) return undefined;
  if (!sortInput) return null;
  const match = /^(.+):(asc|desc)$/.exec(sortInput);
  const descriptor = match ? descriptorSet.fields.get(match[1]) : undefined;
  if (!match || !descriptor || descriptor.field.visibility !== "public" ||
      !descriptor.field.sort ||
      !descriptor.field.sort.directions.includes(match[2] as "asc" | "desc")) return undefined;
  return { fieldKey: match[1], direction: match[2] as "asc" | "desc" };
}

function normalizedRangeFacet(field: DirectoryProfileField, raw: RawFacet): ParsedRangeFacet | null {
  const range: ParsedRangeFacet = {};
  if (raw.min !== undefined) {
    const min = normalizeRangeValue(field, raw.min);
    if (min === null || byteLength(raw.min) > FACET_VALUE_BYTES) return null;
    range.min = min;
  }
  if (raw.max !== undefined) {
    const max = normalizeRangeValue(field, raw.max);
    if (max === null || byteLength(raw.max) > FACET_VALUE_BYTES) return null;
    range.max = max;
  }
  return (range.min || range.max) && rangeOrderValid(field, range) ? range : null;
}

function normalizedFacet(field: DirectoryProfileField, raw: RawFacet): ParsedProfileFacet | null {
  if (raw.values === undefined) return normalizedRangeFacet(field, raw);
  if (raw.min !== undefined || raw.max !== undefined) return null;
  const values = normalizeFacetValues(field, raw.values);
  return values?.length ? { values } : null;
}

function parseFacets(rawFacets: Map<string, RawFacet>,
  descriptorSet: DescriptorSet): Record<string, ParsedProfileFacet> | null {
  const facets: Record<string, ParsedProfileFacet> = {};
  for (const descriptor of descriptorSet.ordered) {
    const raw = rawFacets.get(descriptor.field.key);
    if (!raw) continue;
    const facet = normalizedFacet(descriptor.field, raw);
    if (!facet) return null;
    facets[descriptor.field.key] = facet;
  }
  return facets;
}

export function parseProfileDirectoryQuery(
  input: Record<string, string | string[] | undefined>,
  profiles: ActiveProfileSet = activeDirectoryProfiles(),
): ParsedProfileDirectoryQuery {
  const hasQuery = Object.keys(input).length > 0;
  const fail = () => invalidQuery(hasQuery, profiles.state.revision);
  const size = querySize(input);
  if (size === null || size > QUERY_BYTES) return fail();
  const descriptorSet = descriptors(profiles);
  const rawFacets = collectRawFacets(input, descriptorSet);
  const simple = parseSimpleQuery(input);
  const sort = parseSort(input.sort, descriptorSet);
  const facets = rawFacets && parseFacets(rawFacets, descriptorSet);
  if (!simple || sort === undefined || !facets) return fail();
  return { invalid: false, ...simple, facets, sort, hasQuery,
    profileStateRevision: profiles.state.revision };
}

function appendFacet(result: URLSearchParams, fieldKey: string, facet: ParsedProfileFacet): void {
  if ("min" in facet && facet.min !== undefined) result.set(`min.${fieldKey}`, facet.min);
  if ("max" in facet && facet.max !== undefined) result.set(`max.${fieldKey}`, facet.max);
  if ("values" in facet) {
    for (const value of facet.values) result.append(`facet.${fieldKey}`, value);
  }
}

export function serializeProfileDirectoryQuery(
  query: ParsedProfileDirectoryQuery, page?: number,
): URLSearchParams {
  const result = new URLSearchParams();
  if (query.invalid) return result;
  if (query.q) result.set("q", query.q);
  if (query.category) result.set("category", query.category);
  for (const [fieldKey, facet] of Object.entries(query.facets)) appendFacet(result, fieldKey, facet);
  if (query.sort) result.set("sort", `${query.sort.fieldKey}:${query.sort.direction}`);
  const requestedPage = page ?? query.page;
  if (page !== undefined || requestedPage > 1) result.set("page", String(Math.max(1, requestedPage)));
  return result;
}

function profileIndex(field: DirectoryProfileField): string {
  if (["single-choice", "multiple-choice"].includes(field.type)) return "directory_profile_values_text";
  if (["boolean", "integer", "decimal", "duration"].includes(field.type)) {
    return "directory_profile_values_integer";
  }
  if (field.type === "money") return "directory_profile_values_money";
  if (["date", "datetime", "date-range"].includes(field.type)) return "directory_profile_values_dates";
  if (field.type === "location") return "directory_profile_values_location";
  throw new Error("Unsupported public discovery field");
}

function activeValuePrefix(descriptor: ProfileDiscoveryDescriptor, column: string): SqlFragment {
  return { sql: `v.profile_id = ? AND v.definition_version = ? AND v.field_key = ?
    AND v.archived_at IS NULL AND v.${column} IS NOT NULL`,
  args: [descriptor.profileId, descriptor.definitionVersion, descriptor.field.key] };
}

function locationParts(value: string): [string, string | null, string | null] {
  const [country, region, locality] = value.split("|");
  return [country, region || null, locality || null];
}

function valuesFacetSql(descriptor: ProfileDiscoveryDescriptor, values: string[]): SqlFragment {
  const field = descriptor.field;
  const index = profileIndex(field);
  if (field.type === "location") {
    const prefix = activeValuePrefix(descriptor, "country_code");
    const alternatives = values.map(() =>
      "(v.country_code = ? AND v.region IS ? AND v.locality IS ?)").join(" OR ");
    const args = values.flatMap(locationParts);
    const count = field.facet?.mode === "all" ?
      ` GROUP BY v.listing_slug HAVING COUNT(DISTINCT v.country_code || char(31) ||
        COALESCE(v.region, '') || char(31) || COALESCE(v.locality, '')) = ?` : "";
    return { sql: `EXISTS (SELECT 1 FROM directory_profile_values AS v INDEXED BY ${index}
      WHERE v.listing_slug = l.slug AND ${prefix.sql} AND (${alternatives})${count})`,
    args: [...prefix.args, ...args, ...(count ? [values.length] : [])] };
  }
  const column = field.type === "boolean" ? "integer_value" : "text_value";
  const prefix = activeValuePrefix(descriptor, column);
  const sqlValues = field.type === "boolean" ? values.map((value) => Number(value === "true")) : values;
  const placeholders = sqlValues.map(() => "?").join(", ");
  const count = field.facet?.mode === "all" ?
    ` GROUP BY v.listing_slug HAVING COUNT(DISTINCT v.${column}) = ?` : "";
  return { sql: `EXISTS (SELECT 1 FROM directory_profile_values AS v INDEXED BY ${index}
    WHERE v.listing_slug = l.slug AND ${prefix.sql} AND v.${column} IN (${placeholders})${count})`,
  args: [...prefix.args, ...sqlValues, ...(count ? [sqlValues.length] : [])] };
}

function existsRangeSql(descriptor: ProfileDiscoveryDescriptor, column: string,
  parts: string[], args: SqlArgument[]): SqlFragment {
  const prefix = activeValuePrefix(descriptor, column);
  return { sql: `EXISTS (SELECT 1 FROM directory_profile_values AS v INDEXED BY ${profileIndex(descriptor.field)}
    WHERE v.listing_slug = l.slug AND ${prefix.sql} AND ${parts.join(" AND ")})`,
  args: [...prefix.args, ...args] };
}

function moneyRangeSql(descriptor: ProfileDiscoveryDescriptor, facet: ParsedRangeFacet): SqlFragment {
  const min = facet.min ? moneyPattern.exec(facet.min)! : null;
  const max = facet.max ? moneyPattern.exec(facet.max)! : null;
  const parts = ["v.currency = ?", "v.integer_value IS NOT NULL"];
  const args: SqlArgument[] = [(min ?? max)![1]];
  if (min) { parts.push("v.integer_value >= ?"); args.push(Number(min[2])); }
  if (max) { parts.push("v.integer_value <= ?"); args.push(Number(max[2])); }
  return existsRangeSql(descriptor, "currency", parts, args);
}

function dateRangeSql(descriptor: ProfileDiscoveryDescriptor, facet: ParsedRangeFacet): SqlFragment {
  const parts = ["v.date_end IS NOT NULL"];
  const args: SqlArgument[] = [];
  if (facet.min) { parts.push("v.date_end >= ?"); args.push(facet.min); }
  if (facet.max) { parts.push("v.date_start <= ?"); args.push(facet.max); }
  return existsRangeSql(descriptor, "date_start", parts, args);
}

function rangeFacetSql(descriptor: ProfileDiscoveryDescriptor, facet: ParsedRangeFacet): SqlFragment {
  const field = descriptor.field;
  if (field.type === "money") return moneyRangeSql(descriptor, facet);
  if (field.type === "date-range") return dateRangeSql(descriptor, facet);
  const isDate = field.type === "date" || field.type === "datetime";
  const column = isDate ? "date_start" : "integer_value";
  const scale = field.type === "decimal" ? Number(field.constraints.scale) : 0;
  const convert = (value: string) => field.type === "decimal"
    ? Math.round(Number(value) * (10 ** scale)) : isDate ? value : Number(value);
  const parts: string[] = [];
  const args: SqlArgument[] = [];
  if (facet.min) { parts.push(`v.${column} >= ?`); args.push(convert(facet.min)); }
  if (facet.max) { parts.push(`v.${column} <= ?`); args.push(convert(facet.max)); }
  return existsRangeSql(descriptor, column, parts, args);
}

function escapeLike(value: string): string {
  return `%${value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
}

function ftsPhrase(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function whereSql(query: ParsedProfileDirectoryQuery,
  descriptorSet: DescriptorSet): SqlFragment {
  const where = [PUBLIC_LISTING_PREDICATE];
  const args: SqlArgument[] = [];
  if (query.q) {
    const like = escapeLike(query.q);
    const searchableByProfile = new Map<string, string[]>();
    for (const descriptor of descriptorSet.ordered.filter(({ field }) =>
      field.visibility === "public" && field.searchable)) {
      searchableByProfile.set(descriptor.profileId,
        [...(searchableByProfile.get(descriptor.profileId) ?? []), descriptor.field.key]);
    }
    const searchAllowlist = [...searchableByProfile].map(([, fieldKeys]) =>
      `(directory_profile_search.profile_id = ? AND directory_profile_search.field_key IN (${fieldKeys.map(() => "?").join(", ")}))`);
    where.push(`(l.name LIKE ? ESCAPE '\\' OR l.summary LIKE ? ESCAPE '\\'
      OR l.description LIKE ? ESCAPE '\\' OR EXISTS (
        SELECT 1 FROM directory_profile_search
        WHERE directory_profile_search.listing_slug = l.slug
          AND directory_profile_search MATCH ?
          ${searchAllowlist.length ? `AND (${searchAllowlist.join(" OR ")})` : "AND 0"}
      ))`);
    args.push(like, like, like, ftsPhrase(query.q),
      ...[...searchableByProfile].flatMap(([profileId, fieldKeys]) => [profileId, ...fieldKeys]));
  }
  if (query.category) {
    where.push("l.category = ? COLLATE NOCASE");
    args.push(query.category);
  }
  for (const [fieldKey, facet] of Object.entries(query.facets)) {
    const descriptor = descriptorSet.fields.get(fieldKey);
    if (!descriptor) return { sql: "0", args: [] };
    const fragment = "values" in facet
      ? valuesFacetSql(descriptor, facet.values) : rangeFacetSql(descriptor, facet);
    where.push(fragment.sql);
    args.push(...fragment.args);
  }
  return { sql: where.join(" AND "), args };
}

function sortSql(query: ParsedProfileDirectoryQuery,
  descriptorSet: DescriptorSet): { join: string; order: string; args: SqlArgument[] } {
  if (!query.sort) return { join: "", order: "l.name COLLATE NOCASE, l.slug", args: [] };
  const descriptor = descriptorSet.fields.get(query.sort.fieldKey)!;
  const field = descriptor.field;
  const index = profileIndex(field);
  const column = ["short-text"].includes(field.type) ? "text_value"
    : ["date", "datetime"].includes(field.type) ? "date_start" : "integer_value";
  const partial = column === "text_value" ? "sort_value.text_value IS NOT NULL"
    : column === "date_start" ? "sort_value.date_start IS NOT NULL"
      : field.type === "money" ? "sort_value.currency IS NOT NULL AND sort_value.integer_value IS NOT NULL"
        : "sort_value.integer_value IS NOT NULL";
  const join = `LEFT JOIN directory_profile_values AS sort_value INDEXED BY ${index}
    ON sort_value.listing_slug = l.slug AND sort_value.profile_id = ?
      AND sort_value.definition_version = ? AND sort_value.field_key = ?
      AND sort_value.archived_at IS NULL AND ${partial}`;
  const direction = query.sort.direction.toUpperCase();
  const valueOrder = field.type === "money"
    ? `sort_value.currency ASC, sort_value.integer_value ${direction}`
    : `sort_value.${column}${column === "text_value" ? " COLLATE NOCASE" : ""} ${direction}`;
  return { join, order: `sort_value.${column} IS NULL, ${valueOrder}, l.slug`,
    args: [descriptor.profileId, descriptor.definitionVersion, field.key] };
}

function countableFacet(field: DirectoryProfileField): boolean {
  return ["boolean", "single-choice", "multiple-choice", "location"].includes(field.type);
}

function facetCountSql(descriptor: ProfileDiscoveryDescriptor, where: SqlFragment): SqlFragment | null {
  const field = descriptor.field;
  if (!field.facet || !countableFacet(field)) return null;
  const column = field.type === "boolean" ? "integer_value" : field.type === "location"
    ? "country_code || CASE WHEN region IS NULL AND locality IS NULL THEN '' ELSE '|' || COALESCE(region, '') END || CASE WHEN locality IS NULL THEN '' ELSE '|' || locality END"
    : "text_value";
  const partialColumn = field.type === "boolean" ? "integer_value"
    : field.type === "location" ? "country_code" : "text_value";
  return { sql: `SELECT ${column} AS value, COUNT(DISTINCT v.listing_slug) AS count
    FROM directory_profile_values AS v
    JOIN listings AS l ON l.slug = v.listing_slug
    WHERE v.profile_id = ? AND v.definition_version = ? AND v.field_key = ?
      AND v.archived_at IS NULL AND v.${partialColumn} IS NOT NULL AND ${where.sql}
    GROUP BY ${column}`,
  args: [descriptor.profileId, descriptor.definitionVersion, field.key, ...where.args] };
}

function facetCounts(descriptorSet: DescriptorSet, where: SqlFragment): ProfileFacetCounts {
  const result: ProfileFacetCounts = {};
  for (const descriptor of descriptorSet.ordered.filter(({ field }) => field.facet !== null)) {
    result[descriptor.field.key] = {};
    const fragment = facetCountSql(descriptor, where);
    if (!fragment) continue;
    const rows = database.prepare(fragment.sql).all(...fragment.args) as
      { value: string | number; count: number }[];
    for (const row of rows) {
      const value = descriptor.field.type === "boolean" ? String(Boolean(row.value)) : String(row.value);
      result[descriptor.field.key][value] = row.count;
    }
  }
  return result;
}

function emptyResult(): ProfileDirectoryResult {
  return { listings: [], total: 0, page: 1, pages: 1, facetCounts: {} };
}

export function searchProfileDirectory(
  query: ParsedProfileDirectoryQuery,
): ProfileDirectoryResult {
  if (query.invalid) return emptyResult();
  const profiles = activeDirectoryProfiles();
  if (profiles.state.revision !== query.profileStateRevision) return emptyResult();
  const descriptorSet = descriptors(profiles);
  const where = whereSql(query, descriptorSet);
  const total = (database.prepare(`SELECT COUNT(*) AS count FROM listings AS l WHERE ${where.sql}`)
    .get(...where.args) as { count: number }).count;
  const pages = Math.max(1, Math.ceil(total / LISTINGS_PER_PAGE));
  const page = Math.min(query.page, pages);
  const sort = sortSql(query, descriptorSet);
  const rows = database.prepare(`SELECT l.* FROM listings AS l ${sort.join}
    WHERE ${where.sql} ORDER BY ${sort.order} LIMIT ? OFFSET ?`).all(
    ...sort.args, ...where.args, LISTINGS_PER_PAGE, (page - 1) * LISTINGS_PER_PAGE,
  ) as StoredListing[];
  return { listings: hydratePublicListings(rows), total, page, pages,
    facetCounts: facetCounts(descriptorSet, where) };
}
