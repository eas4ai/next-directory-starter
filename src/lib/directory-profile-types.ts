export type ProfileFieldType =
  | "short-text" | "markdown" | "boolean" | "integer" | "decimal" | "money"
  | "single-choice" | "multiple-choice" | "url" | "date" | "datetime"
  | "date-range" | "duration" | "location" | "media" | "group";

export type ProfileChoice = { value: string; label: string };

export type ProfileChildField = {
  key: string;
  label: string;
  help: string;
  type: Exclude<ProfileFieldType, "group">;
  required: boolean;
  constraints: Record<string, unknown>;
  default?: unknown;
};

export type DirectoryProfileField = {
  key: string;
  label: string;
  help: string;
  type: ProfileFieldType;
  cardinality: "one" | "many";
  required: boolean;
  writeAuthority: "operator" | "owner" | "system";
  visibility: "public" | "staff" | "private";
  placement: "card" | "badge" | "detail" | "hidden";
  group: string | null;
  order: number;
  searchable: boolean;
  facet: { label: string; mode: "any" | "all" } | null;
  sort: { label: string; directions: ("asc" | "desc")[] } | null;
  constraints: Record<string, unknown>;
  default?: unknown;
};

export type DirectoryProfileDefinition = {
  schemaVersion: 1;
  id: string;
  version: string;
  name: string;
  description: string;
  fields: DirectoryProfileField[];
};

export type ProfileMoney = { amountMinor: number; currency: string };
export type ProfileDateRange = { start: string; end: string };
export type ProfileLocation = {
  countryCode: string;
  region?: string;
  locality?: string;
  latitude?: number;
  longitude?: number;
};
export type ProfileGroupItem = { id: string; values: Record<string, unknown> };
export type ProfileRepeatedValue = { id: string; value: unknown };
export type CanonicalProfileValue = unknown;
export type ProfileValueSet = Record<string, unknown>;
declare const validatedProfileValues: unique symbol;
export type ValidatedProfileValues = ProfileValueSet & {
  readonly [validatedProfileValues]: true;
};

export type NormalizedProfileRow = {
  itemId: string;
  childKey: string;
  position: number;
  valueType: Exclude<ProfileFieldType, "group">;
  textValue: string | null;
  integerValue: number | null;
  realValue: number | null;
  currency: string | null;
  dateStart: string | null;
  dateEnd: string | null;
  countryCode: string | null;
  region: string | null;
  locality: string | null;
  latitudeE6: number | null;
  longitudeE6: number | null;
  mediaId: string | null;
};

export type StoredProfileReference = {
  profileId: string;
  version: string;
  digest: string;
  name: string;
};

export type DirectoryProfileState = {
  revision: number;
  base: StoredProfileReference | null;
  site: StoredProfileReference | null;
};

export type ProfileMigrationAction =
  | { action: "archive" }
  | { action: "map"; to: string; onInvalid: "reject" | "archive";
      choiceMap?: Record<string, string> };

export type ProfileMigrationPlan = {
  fields: Record<string, ProfileMigrationAction>;
  defaults: Record<string, unknown>;
};

export type ProfileImpact = {
  compatible: boolean;
  breakingFields: string[];
  affectedListings: number;
  affectedValues: number;
  publishedMissingRequired: number;
  invalidSamples: { slug: string; fieldKey: string; reason: string }[];
  stateRevision: number;
};

export type ActiveProfileSet = {
  state: DirectoryProfileState;
  definitions: DirectoryProfileDefinition[];
};
