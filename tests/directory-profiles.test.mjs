import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseListing } from "../src/lib/catalog-input.ts";
import { parseManifest } from "../scripts/addons/manifest.mjs";

const repository = resolve(import.meta.dirname, "..");
const selectedRequirement = process.env.PROFILE_REQUIREMENT;

function requirementTest(name, body) {
  if (!selectedRequirement || name.startsWith(selectedRequirement)) test(name, body);
}

const profileDirectory = mkdtempSync(join(tmpdir(), "directory-profiles-"));
const previousDatabaseUrl = process.env.DATABASE_URL;
process.env.DATABASE_URL = `file:${join(profileDirectory, "catalog.db")}`;
let profileDatabase;

test.after(() => {
  profileDatabase?.close();
  if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabaseUrl;
  rmSync(profileDirectory, { recursive: true, force: true });
});

function commonField(key, label, type, constraints = {}) {
  return {
    key,
    label,
    help: `${label} help`,
    type,
    cardinality: type === "multiple-choice" || type === "group" ? "many" : "one",
    required: false,
    writeAuthority: "owner",
    visibility: "public",
    placement: "detail",
    group: "Details",
    order: 10,
    searchable: ["short-text", "markdown"].includes(type),
    facet: null,
    sort: null,
    constraints,
  };
}

function completeProfile(overrides = {}) {
  const fields = [
    commonField("vendor.ai-tools.tagline", "Tagline", "short-text",
      { minLength: 1, maxLength: 120 }),
    commonField("vendor.ai-tools.notes", "Notes", "markdown",
      { minLength: 0, maxLength: 5000 }),
    { ...commonField("vendor.ai-tools.open-source", "Open source", "boolean"),
      facet: { label: "Open source", mode: "any" } },
    { ...commonField("vendor.ai-tools.team-size", "Team size", "integer",
      { min: 0, max: 1000000 }), sort: { label: "Team size", directions: ["asc", "desc"] } },
    { ...commonField("vendor.ai-tools.rating", "Rating", "decimal",
      { min: "0.00", max: "5.00", scale: 2 }),
      sort: { label: "Rating", directions: ["asc", "desc"] } },
    { ...commonField("vendor.ai-tools.starting-price", "Starting price", "money",
      { minMinor: 0, maxMinor: 100000000, currencies: ["EUR", "USD"] }),
      facet: { label: "Starting price", mode: "any" },
      sort: { label: "Starting price", directions: ["asc", "desc"] } },
    { ...commonField("vendor.ai-tools.pricing-model", "Pricing model", "single-choice",
      { choices: [{ value: "free", label: "Free" }, { value: "paid", label: "Paid" }] }),
      facet: { label: "Pricing model", mode: "any" } },
    { ...commonField("vendor.ai-tools.platforms", "Platforms", "multiple-choice",
      { choices: [{ value: "web", label: "Web" }, { value: "mac", label: "macOS" }] }),
      facet: { label: "Platforms", mode: "all" } },
    commonField("vendor.ai-tools.docs", "Documentation", "url"),
    { ...commonField("vendor.ai-tools.launched", "Launched", "date",
      { min: "2000-01-01", max: "2100-12-31" }),
      facet: { label: "Launched", mode: "any" } },
    commonField("vendor.ai-tools.updated", "Updated", "datetime",
      { min: "2000-01-01T00:00:00.000Z", max: "2100-12-31T23:59:59.999Z" }),
    { ...commonField("vendor.ai-tools.availability", "Availability", "date-range",
      { min: "2000-01-01", max: "2100-12-31" }),
      facet: { label: "Availability", mode: "any" } },
    { ...commonField("vendor.ai-tools.setup-time", "Setup time", "duration",
      { minSeconds: 0, maxSeconds: 31536000 }),
      facet: { label: "Setup time", mode: "any" } },
    { ...commonField("vendor.ai-tools.headquarters", "Headquarters", "location",
      { countries: ["CA", "US"] }), facet: { label: "Location", mode: "any" } },
    commonField("vendor.ai-tools.screenshot", "Screenshot", "media", { maxItems: 4 }),
    commonField("vendor.ai-tools.integrations", "Integrations", "group", {
      minItems: 0,
      maxItems: 25,
      children: [
        { key: "name", label: "Name", help: "Integration name", type: "short-text",
          required: true, constraints: { minLength: 1, maxLength: 80 } },
        { key: "url", label: "URL", help: "Integration URL", type: "url",
          required: false, constraints: {} },
        { key: "native", label: "Native", help: "Native integration", type: "boolean",
          required: false, constraints: {} },
      ],
    }),
  ];
  return {
    schemaVersion: 1,
    id: "vendor.ai-tools",
    version: "1.0.0",
    name: "AI tools",
    description: "Structured fields for an AI tools directory.",
    fields,
    ...overrides,
  };
}

function authoringProfile(overrides = {}) {
  const profile = structuredClone(completeProfile(overrides));
  const tagline = profile.fields.find(({ key }) => key === "vendor.ai-tools.tagline");
  tagline.writeAuthority = "operator";
  const notes = profile.fields.find(({ key }) => key === "vendor.ai-tools.notes");
  notes.visibility = "private";
  notes.placement = "hidden";
  notes.searchable = false;
  const updated = profile.fields.find(({ key }) => key === "vendor.ai-tools.updated");
  updated.writeAuthority = "operator";
  profile.fields.push({ ...commonField("vendor.ai-tools.system-note", "System note", "short-text",
    { minLength: 0, maxLength: 120 }), writeAuthority: "system", visibility: "staff",
    placement: "hidden", searchable: false });
  profile.fields.find(({ key }) => key === "vendor.ai-tools.pricing-model").required = true;
  return profile;
}

function completeProfileValues({ includeOperator = true, includeSystem = true,
  mediaId = "123e4567-e89b-12d3-a456-426614174000" } = {}) {
  return {
    ...(includeOperator ? { "vendor.ai-tools.tagline": "A concise tagline" } : {}),
    "vendor.ai-tools.notes": "**Private** owner notes",
    "vendor.ai-tools.open-source": true,
    "vendor.ai-tools.team-size": 42,
    "vendor.ai-tools.rating": "4.25",
    "vendor.ai-tools.starting-price": { amountMinor: 1299, currency: "USD" },
    "vendor.ai-tools.pricing-model": "paid",
    "vendor.ai-tools.platforms": ["web", "mac"],
    "vendor.ai-tools.docs": "https://example.com/docs",
    "vendor.ai-tools.launched": "2026-10-14",
    ...(includeOperator ? { "vendor.ai-tools.updated": "2026-10-14T16:00:00.000Z" } : {}),
    "vendor.ai-tools.availability": { start: "2026-10-01", end: "2026-10-31" },
    "vendor.ai-tools.setup-time": 7200,
    "vendor.ai-tools.headquarters": { countryCode: "US", region: "NY",
      locality: "New York", latitude: 40.7128, longitude: -74.006 },
    "vendor.ai-tools.screenshot": mediaId,
    "vendor.ai-tools.integrations": [{ id: "integration-slack", values: {
      name: "Slack", url: "https://example.com/slack", native: true,
    } }],
    ...(includeSystem ? { "vendor.ai-tools.system-note": "Automated classification" } : {}),
  };
}

function listingInput(slug, profileValues, profileStateRevision, overrides = {}) {
  return {
    slug,
    name: `Profile ${slug}`,
    summary: "A listing with complete typed profile values.",
    description: "The core and profile record must move through one revision.",
    category: "Tools",
    url: `https://example.com/${slug}`,
    status: "draft",
    revision: 1,
    profileValues,
    profileStateRevision,
    ...overrides,
  };
}

function reorderedObject(value) {
  if (Array.isArray(value)) return value.map(reorderedObject);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).reverse()
    .map(([key, child]) => [key, reorderedObject(child)]));
}

async function profileTestContext() {
  const { database } = await import("../src/lib/database.ts");
  profileDatabase = database;
  const { migrateCatalog } = await import("../src/lib/catalog-migrations.ts");
  migrateCatalog();
  database.exec(`CREATE TABLE IF NOT EXISTS "user" (
    id TEXT PRIMARY KEY, email TEXT, role TEXT, banned INTEGER NOT NULL DEFAULT 0,
    emailVerified INTEGER NOT NULL DEFAULT 0
  )`);
  database.prepare(`INSERT OR REPLACE INTO "user" (id, email, role, banned, emailVerified)
    VALUES (?, ?, ?, ?, ?)`).run("profile-admin", "admin@example.invalid", "admin", 0, 1);
  database.prepare(`INSERT OR REPLACE INTO "user" (id, email, role, banned, emailVerified)
    VALUES (?, ?, ?, ?, ?)`).run("profile-catalog", "catalog@example.invalid", "catalog", 0, 1);
  database.prepare(`INSERT OR REPLACE INTO "user" (id, email, role, banned, emailVerified)
    VALUES (?, ?, ?, ?, ?)`).run("profile-moderator", "moderator@example.invalid", "moderator", 0, 1);
  database.prepare(`INSERT OR REPLACE INTO "user" (id, email, role, banned, emailVerified)
    VALUES (?, ?, ?, ?, ?)`).run("profile-owner", "owner@example.invalid", null, 0, 1);
  database.prepare(`INSERT OR REPLACE INTO "user" (id, email, role, banned, emailVerified)
    VALUES (?, ?, ?, ?, ?)`).run("profile-banned", "banned@example.invalid", "admin", 1, 1);
  database.prepare(`INSERT OR REPLACE INTO "user" (id, email, role, banned, emailVerified)
    VALUES (?, ?, ?, ?, ?)`).run("profile-unverified", "unverified@example.invalid", "admin", 0, 0);
  const modulePath = join(repository, "src/lib/directory-profiles.ts");
  assert.ok(existsSync(modulePath),
    "directory-profile definition and lifecycle module is missing");
  const api = await import(pathToFileURL(modulePath).href);
  return { database, ...api };
}

async function profileCodecContext() {
  const schemaPath = join(repository, "scripts/addons/profile-schema.mjs");
  const valuesPath = join(repository, "src/lib/profile-values.ts");
  assert.ok(existsSync(schemaPath), "shared directory-profile runtime schema is missing");
  assert.ok(existsSync(valuesPath), "typed directory-profile value codecs are missing");
  return {
    ...await import(pathToFileURL(schemaPath).href),
    ...await import(pathToFileURL(valuesPath).href),
  };
}

function resetProfileTables(database) {
  database.exec(`DELETE FROM directory_profile_search;
    DELETE FROM directory_profile_media;
    DELETE FROM directory_profile_values;
    DELETE FROM directory_profile_changes;
    DELETE FROM directory_profile_seed_runs;
    DELETE FROM directory_profile_state;
    DELETE FROM directory_profile_definitions;
    DELETE FROM submissions;
    DELETE FROM owner_drafts;
    DELETE FROM audit_events;
    DELETE FROM media_assignments;
    DELETE FROM media_cleanup_queue;
    DELETE FROM media_assets;
    DELETE FROM listings;
    DELETE FROM categories;`);
  database.prepare(`INSERT INTO directory_profile_state
    (id, revision, updated_at, updated_by) VALUES (1, 0, ?, ?)`)
    .run("2026-10-14T00:00:00.000Z", "system");
}

function profileSnapshot(database) {
  const tables = [
    "directory_profile_definitions", "directory_profile_state", "directory_profile_values",
    "directory_profile_changes", "directory_profile_media", "directory_profile_seed_runs",
  ];
  return Object.fromEntries(tables.map((table) =>
    [table, database.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
}

function activate(api, definition, expectedRevision, migration) {
  return api.activateDirectoryProfile({
    definition,
    sourceKind: "addon",
    sourceId: definition.id.split(".")[0],
    expectedRevision,
    migration,
    actorUserId: "profile-admin",
  });
}

function insertListing(database, slug = "profile-listing", status = "published") {
  database.prepare("INSERT OR IGNORE INTO categories (name) VALUES ('Tools')").run();
  database.prepare(`INSERT INTO listings
    (slug, name, summary, description, category, url, destination_key, status, revision)
    VALUES (?, ?, 'Profile summary', 'Profile description', 'Tools', ?, ?, ?, 1)`)
    .run(slug, `Profile ${slug}`, `https://example.com/${slug}`,
      `https://example.com/${slug}`, status);
}

function insertValue(database, {
  slug = "profile-listing", profileId = "vendor.ai-tools", version = "1.0.0",
  fieldKey = "vendor.ai-tools.starting-price", itemId = "value", valueType = "money",
  textValue = null, integerValue = 1299, currency = "USD", archivedAt = null,
} = {}) {
  database.prepare(`INSERT INTO directory_profile_values
    (listing_slug, profile_id, definition_version, field_key, item_id, child_key,
      position, value_type, text_value, integer_value, currency, archived_at, updated_at)
    VALUES (?, ?, ?, ?, ?, '', 0, ?, ?, ?, ?, ?, ?)`)
    .run(slug, profileId, version, fieldKey, itemId, valueType, textValue,
      integerValue, currency, archivedAt, "2026-10-14T00:00:00.000Z");
}

function insertProfileMedia(database, { id = "123e4567-e89b-12d3-a456-426614174000",
  slug = "profile-listing", fieldKey = "vendor.ai-tools.screenshot",
  uploadedBy = "profile-owner", state = "draft" } = {}) {
  database.prepare(`INSERT INTO media_assets
    (id, target_kind, target_slug, uploaded_by, alt, width, height, created_at)
    VALUES (?, 'listing', ?, ?, 'Profile image', 1200, 800, ?)`)
    .run(id, slug, uploadedBy, "2026-10-14T00:00:00.000Z");
  database.prepare(`INSERT INTO directory_profile_media
    (asset_id, listing_slug, field_key, item_id, state, uploaded_by, created_at)
    VALUES (?, ?, ?, 'value', ?, ?, ?)`)
    .run(id, slug, fieldKey, state, uploadedBy, "2026-10-14T00:00:00.000Z");
}

requirementTest("PRF-001 activates immutable versioned directory-profile definitions", async (t) => {
  await t.test("validates all field families and rejects invalid definitions", async () => {
    const api = await profileCodecContext();
    const parsed = api.parseDirectoryProfileDefinition(completeProfile());
    assert.deepEqual(parsed.fields.map(({ type }) => type), [
      "short-text", "markdown", "boolean", "integer", "decimal", "money",
      "single-choice", "multiple-choice", "url", "date", "datetime", "date-range",
      "duration", "location", "media", "group",
    ]);
    assert.throws(() => api.parseDirectoryProfileDefinition({
      ...completeProfile(),
      fields: [...completeProfile().fields, completeProfile().fields[0]],
    }), /duplicate field/i);
    const unbounded = structuredClone(completeProfile());
    unbounded.fields.at(-1).constraints.maxItems = 26;
    assert.throws(() => api.parseDirectoryProfileDefinition(unbounded), /25|bounded|maxItems/i);
    const unsafe = structuredClone(completeProfile());
    unsafe.fields.find(({ type }) => type === "url").default = "javascript:alert(1)";
    assert.throws(() => api.parseDirectoryProfileDefinition(unsafe), /URL|protocol|default/i);
    const privateFacet = structuredClone(completeProfile());
    const faceted = privateFacet.fields.find(({ facet }) => facet);
    faceted.visibility = "private";
    assert.throws(() => api.parseDirectoryProfileDefinition(privateFacet), /visibility|public|facet/i);
    const defaults = structuredClone(completeProfile());
    defaults.fields.find(({ type }) => type === "decimal").default = "4.2";
    defaults.fields.find(({ type }) => type === "money").default =
      { amountMinor: 1299, currency: "usd" };
    defaults.fields.find(({ type }) => type === "multiple-choice").default = ["mac", "web"];
    defaults.fields.find(({ type }) => type === "datetime").default =
      "2026-10-14T12:00:00-04:00";
    defaults.fields.find(({ type }) => type === "location").default =
      { countryCode: "us", region: " NY ", latitude: 40.7128, longitude: -74.006 };
    defaults.fields.find(({ type }) => type === "group").default = [
      { id: "slack", values: { name: "Slack", native: true } },
    ];
    const normalized = api.parseDirectoryProfileDefinition(defaults);
    assert.equal(normalized.fields.find(({ type }) => type === "decimal").default, "4.20");
    assert.deepEqual(normalized.fields.find(({ type }) => type === "money").default,
      { amountMinor: 1299, currency: "USD" });
    assert.deepEqual(normalized.fields.find(({ type }) => type === "multiple-choice").default,
      ["web", "mac"]);
    assert.equal(normalized.fields.find(({ type }) => type === "datetime").default,
      "2026-10-14T16:00:00.000Z");
    assert.deepEqual(normalized.fields.find(({ type }) => type === "location").default,
      { countryCode: "US", region: "NY", latitude: 40.7128, longitude: -74.006 });
    const invalidGroup = structuredClone(defaults);
    invalidGroup.fields.find(({ type }) => type === "group").default = [
      { id: "slack", values: { native: true } },
    ];
    assert.throws(() => api.parseDirectoryProfileDefinition(invalidGroup), /group|name|required/i);
    const invalidLocation = structuredClone(defaults);
    invalidLocation.fields.find(({ type }) => type === "location").default.latitude = 91;
    assert.throws(() => api.parseDirectoryProfileDefinition(invalidLocation), /location|latitude/i);
  });

  await t.test("canonicalizes definitions and produces stable digests", async () => {
    const api = await profileCodecContext();
    const definition = completeProfile();
    assert.equal(api.profileDigest(definition), api.profileDigest(reorderedObject(definition)));
    assert.equal(api.canonicalProfileJson(definition), api.canonicalProfileJson(reorderedObject(definition)));
    assert.match(api.profileDigest(definition), /^[a-f0-9]{64}$/);
  });

  await t.test("normalizes and round-trips every typed field family", async () => {
    const api = await profileCodecContext();
    const profile = api.parseDirectoryProfileDefinition(completeProfile());
    const values = new Map([
      ["short-text", "A concise tagline"],
      ["markdown", "**Safe** details"],
      ["boolean", false],
      ["integer", 42],
      ["decimal", "4.25"],
      ["money", { amountMinor: 1299, currency: "usd" }],
      ["single-choice", "paid"],
      ["multiple-choice", ["mac", "web"]],
      ["url", "https://example.com/docs"],
      ["date", "2026-10-14"],
      ["datetime", "2026-10-14T12:00:00-04:00"],
      ["date-range", { start: "2026-10-01", end: "2026-10-31" }],
      ["duration", 7200],
      ["location", { countryCode: "us", region: "NY", locality: "New York",
        latitude: 40.7128, longitude: -74.006 }],
      ["media", "123e4567-e89b-12d3-a456-426614174000"],
      ["group", [{ id: "integration-slack", values: {
        name: "Slack", url: "https://example.com/slack", native: true,
      } }]],
    ]);
    const expected = new Map(values);
    expected.set("money", { amountMinor: 1299, currency: "USD" });
    expected.set("multiple-choice", ["web", "mac"]);
    expected.set("datetime", "2026-10-14T16:00:00.000Z");
    expected.set("location", { countryCode: "US", region: "NY", locality: "New York",
      latitude: 40.7128, longitude: -74.006 });
    for (const field of profile.fields) {
      const value = api.validateProfileFieldValue(field, values.get(field.type), {
        isMediaAllowed: (id) => id === "123e4567-e89b-12d3-a456-426614174000",
      });
      const rows = api.encodeProfileValue(field, value);
      assert.deepEqual(api.decodeProfileValue(field, rows), expected.get(field.type),
        `${field.type} did not round-trip through normalized rows`);
    }
    const integer = profile.fields.find(({ type }) => type === "integer");
    assert.throws(() => api.validateProfileFieldValue(integer, Number.MAX_SAFE_INTEGER + 1, {}),
      /integer|safe|maximum/i);
    const dateRange = profile.fields.find(({ type }) => type === "date-range");
    assert.throws(() => api.validateProfileFieldValue(dateRange,
      { start: "2026-11-01", end: "2026-10-01" }, {}), /range|start|end/i);
    const url = profile.fields.find(({ type }) => type === "url");
    assert.throws(() => api.validateProfileFieldValue(url,
      "https://user:secret@example.com", {}), /credential|URL/i);
    const repeatedMedia = { ...profile.fields.find(({ type }) => type === "media"),
      cardinality: "many", constraints: { maxItems: 2 } };
    assert.throws(() => api.validateProfileFieldValue(repeatedMedia, [
      { id: "one", value: "123e4567-e89b-12d3-a456-426614174000" },
      { id: "two", value: "123e4567-e89b-12d3-a456-426614174000" },
      { id: "three", value: "123e4567-e89b-12d3-a456-426614174000" },
    ], {}), /media|bounded|maxItems|too many/i);
  });

  await t.test("creates normalized profile storage idempotently", async () => {
    const { database } = await import("../src/lib/database.ts");
    profileDatabase = database;
    const { migrateCatalog } = await import("../src/lib/catalog-migrations.ts");
    migrateCatalog();
    migrateCatalog();
    const tables = new Set(database.prepare(`SELECT name FROM sqlite_master
      WHERE type IN ('table', 'view')`).all().map(({ name }) => name));
    for (const name of [
      "directory_profile_definitions", "directory_profile_state", "directory_profile_values",
      "directory_profile_changes", "directory_profile_media", "directory_profile_seed_runs",
      "directory_profile_search",
    ]) assert.ok(tables.has(name), `migration 33 did not create ${name}`);
    assert.deepEqual(database.pragma("foreign_key_check"), []);
    assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM directory_profile_state
      WHERE id = 1 AND revision = 0`).get().count, 1);
  });

  await t.test("stores immutable definitions and protects activation", async () => {
    const api = await profileTestContext();
    resetProfileTables(api.database);
    const untouched = profileSnapshot(api.database);
    for (const actorUserId of ["profile-catalog", "profile-moderator", "profile-owner",
      "profile-banned", "profile-unverified", "profile-missing"]) {
      assert.throws(() => api.activateDirectoryProfile({
        definition: completeProfile(), sourceKind: "addon", sourceId: "vendor",
        expectedRevision: 0, actorUserId,
      }), /Forbidden|admin/i, `${actorUserId} activated a profile`);
      assert.deepEqual(profileSnapshot(api.database), untouched,
        `${actorUserId} changed profile state before rejection`);
    }
    const first = activate(api, completeProfile(), 0);
    assert.equal(first.revision, 1);
    assert.equal(first.base.profileId, "vendor.ai-tools");
    assert.equal(first.base.version, "1.0.0");
    assert.equal(first.base.digest, api.profileDigest(completeProfile()));
    const before = profileSnapshot(api.database);
    assert.throws(() => activate(api, completeProfile({ name: "Changed bytes" }), 1),
      /immutable|same version|digest/i);
    assert.deepEqual(profileSnapshot(api.database), before);
    assert.equal(api.database.prepare(`SELECT COUNT(*) AS count FROM audit_events
      WHERE action = 'profile.activate'`).get().count, 1);
  });

  await t.test("reports and applies explicit breaking mappings atomically", async () => {
    const api = await profileTestContext();
    resetProfileTables(api.database);
    activate(api, completeProfile(), 0);
    insertListing(api.database);
    insertValue(api.database);
    const compatible = completeProfile({ version: "1.1.0", fields: [
      ...completeProfile().fields,
      commonField("vendor.ai-tools.support-email", "Support email", "short-text",
        { minLength: 0, maxLength: 200 }),
    ] });
    const compatibleImpact = api.profileImpact({ definition: compatible, expectedRevision: 1 });
    assert.equal(compatibleImpact.compatible, true);
    activate(api, compatible, 1);
    const renamedFields = compatible.fields
      .filter(({ key }) => key !== "vendor.ai-tools.starting-price")
      .concat({ ...compatible.fields.find(({ key }) => key === "vendor.ai-tools.starting-price"),
        key: "vendor.ai-tools.price", label: "Price", required: true });
    const breaking = completeProfile({ version: "2.0.0", fields: renamedFields });
    const impact = api.profileImpact({ definition: breaking, expectedRevision: 2 });
    assert.equal(impact.compatible, false);
    assert.deepEqual(impact.breakingFields,
      ["vendor.ai-tools.price", "vendor.ai-tools.starting-price"]);
    const before = profileSnapshot(api.database);
    assert.throws(() => activate(api, breaking, 2), /mapping|breaking/i);
    assert.deepEqual(profileSnapshot(api.database), before);
    assert.throws(() => activate(api, breaking, 2, { fields: {
      "vendor.ai-tools.starting-price": {
        action: "map", to: "vendor.ai-tools.missing", onInvalid: "reject",
      },
    }, defaults: {} }), /target|missing|field/i);
    assert.deepEqual(profileSnapshot(api.database), before);
    const mapping = { fields: {
      "vendor.ai-tools.starting-price": {
        action: "map", to: "vendor.ai-tools.price", onInvalid: "reject",
      },
    }, defaults: {} };
    assert.equal(api.profileImpact({ definition: breaking, expectedRevision: 2,
      migration: mapping }).publishedMissingRequired, 0);
    const migrated = activate(api, breaking, 2, mapping);
    assert.equal(migrated.revision, 3);
    const current = api.database.prepare(`SELECT field_key, integer_value, currency, archived_at
      FROM directory_profile_values WHERE listing_slug = ? ORDER BY field_key, archived_at`)
      .all("profile-listing");
    assert.equal(current.some((row) => row.field_key === "vendor.ai-tools.price" &&
      row.integer_value === 1299 && row.currency === "USD" && row.archived_at === null), true);
    assert.equal(current.some((row) => row.field_key === "vendor.ai-tools.starting-price" &&
      row.archived_at !== null), true);
  });

  await t.test("rejects stale and unsatisfied required-field activation without partial writes", async () => {
    const api = await profileTestContext();
    resetProfileTables(api.database);
    activate(api, completeProfile(), 0);
    insertListing(api.database);
    const required = structuredClone(completeProfile({ version: "2.0.0" }));
    const tagline = required.fields.find(({ key }) => key === "vendor.ai-tools.tagline");
    tagline.required = true;
    const impact = api.profileImpact({ definition: required, expectedRevision: 1 });
    assert.equal(impact.publishedMissingRequired, 1);
    const before = profileSnapshot(api.database);
    assert.throws(() => activate(api, required, 0), /stale|revision|changed/i);
    assert.deepEqual(profileSnapshot(api.database), before);
    assert.throws(() => activate(api, required, 1), /required|default|mapping/i);
    assert.deepEqual(profileSnapshot(api.database), before);
    const state = activate(api, required, 1, { fields: {}, defaults: {
      "vendor.ai-tools.tagline": "Migrated tagline",
    } });
    assert.equal(state.revision, 2);
    assert.equal(api.database.prepare(`SELECT text_value FROM directory_profile_values
      WHERE listing_slug = 'profile-listing' AND field_key = 'vendor.ai-tools.tagline'
        AND archived_at IS NULL`).get().text_value, "Migrated tagline");
  });

  await t.test("versions site fields, archives values, confirms purges, and audits actions", async () => {
    const api = await profileTestContext();
    resetProfileTables(api.database);
    activate(api, completeProfile(), 0);
    const siteField = commonField("site.certified", "Certified", "boolean");
    const siteState = api.saveSiteField({ field: siteField, expectedRevision: 1,
      actorUserId: "profile-admin" });
    assert.equal(siteState.site.profileId, "site.local");
    assert.equal(siteState.site.version, "0.0.2");
    insertListing(api.database);
    insertValue(api.database, { profileId: "site.local", version: "0.0.2",
      fieldKey: "site.certified", valueType: "boolean", integerValue: 1, currency: null });
    assert.throws(() => api.saveSiteField({
      field: { ...siteField, key: "vendor.not-site" }, expectedRevision: 2,
      actorUserId: "profile-admin",
    }), /site\.|namespace/i);
    const archivedState = api.archiveSiteField({ fieldKey: "site.certified",
      expectedRevision: 2, actorUserId: "profile-admin" });
    assert.equal(archivedState.revision, 3);
    assert.ok(api.database.prepare(`SELECT archived_at FROM directory_profile_values
      WHERE field_key = 'site.certified'`).get().archived_at);
    assert.throws(() => api.purgeArchivedProfileValues({ profileId: "site.local",
      fieldKey: "site.certified", expectedCount: 2, expectedRevision: 3,
      actorUserId: "profile-admin" }), /count|changed/i);
    assert.equal(api.purgeArchivedProfileValues({ profileId: "site.local",
      fieldKey: "site.certified", expectedCount: 1, expectedRevision: 3,
      actorUserId: "profile-admin" }), 1);
    const actions = api.database.prepare(`SELECT action FROM audit_events
      WHERE action LIKE 'profile.%' ORDER BY occurred_at, id`).all().map(({ action }) => action);
    assert.deepEqual(actions, ["profile.activate", "profile.site-field.save",
      "profile.site-field.archive", "profile.values.purge"]);
  });

  await t.test("switches active profiles without deleting inactive definitions or values", async () => {
    const api = await profileTestContext();
    resetProfileTables(api.database);
    activate(api, completeProfile(), 0);
    insertListing(api.database);
    insertValue(api.database);
    const places = {
      ...completeProfile(), id: "vendor.places", version: "1.0.0", name: "Places",
      fields: [commonField("vendor.places.neighborhood", "Neighborhood", "short-text",
        { minLength: 0, maxLength: 100 })],
    };
    const switched = activate(api, places, 1, { fields: {
      "vendor.ai-tools.starting-price": { action: "archive" },
    }, defaults: {} });
    assert.equal(switched.base.profileId, "vendor.places");
    assert.equal(api.database.prepare(`SELECT COUNT(*) AS count FROM directory_profile_definitions
      WHERE profile_id = 'vendor.ai-tools'`).get().count, 1);
    assert.equal(api.database.prepare(`SELECT COUNT(*) AS count FROM directory_profile_values
      WHERE profile_id = 'vendor.ai-tools'`).get().count, 1);
  });

  await t.test("bounds online migrations before changing state", async () => {
    const api = await profileTestContext();
    resetProfileTables(api.database);
    activate(api, completeProfile(), 0);
    insertListing(api.database);
    api.database.exec(`WITH RECURSIVE sequence(value) AS (
      VALUES(1) UNION ALL SELECT value + 1 FROM sequence WHERE value < 100001
    ) INSERT INTO directory_profile_values
      (listing_slug, profile_id, definition_version, field_key, item_id, child_key,
        position, value_type, text_value, updated_at)
      SELECT 'profile-listing', 'vendor.ai-tools', '1.0.0', 'vendor.ai-tools.tagline',
        printf('item-%06d', value), '', value % 25, 'short-text', 'bounded',
        '2026-10-14T00:00:00.000Z' FROM sequence;`);
    const narrowed = structuredClone(completeProfile({ version: "2.0.0" }));
    narrowed.fields.find(({ key }) => key === "vendor.ai-tools.tagline")
      .constraints.maxLength = 20;
    const before = api.directoryProfileState();
    assert.throws(() => api.profileImpact({ definition: narrowed, expectedRevision: 1 }),
      /100,000|migration|limit/i);
    assert.deepEqual(api.directoryProfileState(), before);
  });
});

requirementTest("PRF-002 validates profile values with the complete listing revision", async (t) => {
  await t.test("validates complete typed records, authority, safety, and owned media", async () => {
    const api = await profileTestContext();
    resetProfileTables(api.database);
    activate(api, authoringProfile(), 0);
    insertListing(api.database, "profile-values", "draft");
    insertProfileMedia(api.database, { slug: "profile-values" });
    const valuesApi = await import("../src/lib/profile-values.ts");
    assert.equal(typeof valuesApi.validateProfileValues, "function",
      "complete profile-value validation is missing");
    const profiles = api.activeDirectoryProfiles();
    const allTypes = completeProfileValues();
    const validated = valuesApi.validateProfileValues(allTypes, {
      profiles, authority: "system", listingSlug: "profile-values",
      actorUserId: "profile-admin", requireComplete: true,
    });
    assert.deepEqual(validated, allTypes);

    const ownerValues = completeProfileValues({ includeOperator: false, includeSystem: false });
    assert.deepEqual(valuesApi.validateProfileValues(ownerValues, {
      profiles, authority: "owner", listingSlug: "profile-values",
      actorUserId: "profile-owner", requireComplete: true,
    }), ownerValues);
    assert.throws(() => valuesApi.validateProfileValues({ ...ownerValues,
      "vendor.ai-tools.tagline": "Owner override" }, {
      profiles, authority: "owner", listingSlug: "profile-values",
      actorUserId: "profile-owner", requireComplete: true,
    }), /authority|permission|operator/i);
    assert.throws(() => valuesApi.validateProfileValues({ ...allTypes,
      "vendor.ai-tools.notes": "<script>private sentinel</script>" }, {
      profiles, authority: "system", listingSlug: "profile-values",
      actorUserId: "profile-admin", requireComplete: true,
    }), /Markdown|active|unsafe/i);
    assert.throws(() => valuesApi.validateProfileValues({ ...allTypes,
      "vendor.ai-tools.docs": "javascript:alert(1)" }, {
      profiles, authority: "system", listingSlug: "profile-values",
      actorUserId: "profile-admin", requireComplete: true,
    }), /URL|protocol|safe/i);
    assert.throws(() => valuesApi.validateProfileValues({ ...allTypes,
      "vendor.ai-tools.screenshot": "223e4567-e89b-42d3-a456-426614174000" }, {
      profiles, authority: "system", listingSlug: "profile-values",
      actorUserId: "profile-admin", requireComplete: true,
    }), /media|owned|available/i);
    assert.throws(() => valuesApi.validateProfileValues({ ...allTypes,
      "vendor.ai-tools.unknown": "private leak sentinel" }, {
      profiles, authority: "system", listingSlug: "profile-values",
      actorUserId: "profile-admin", requireComplete: true,
    }), /unknown|field/i);
    const missing = { ...ownerValues };
    delete missing["vendor.ai-tools.pricing-model"];
    assert.throws(() => valuesApi.validateProfileValues(missing, {
      profiles, authority: "owner", listingSlug: "profile-values",
      actorUserId: "profile-owner", requireComplete: true,
    }), /pricing-model|required/i);
  });

  await t.test("stores core and normalized values atomically and hydrates listings in a batch", async () => {
    const api = await profileTestContext();
    resetProfileTables(api.database);
    activate(api, authoringProfile(), 0);
    const profileValues = completeProfileValues({ includeSystem: false,
      mediaId: undefined });
    delete profileValues["vendor.ai-tools.screenshot"];
    const parsed = parseListing(listingInput("admin-profile", profileValues, 1));
    assert.ok(parsed, "the complete core and profile listing must parse");
    assert.deepEqual(parsed.profileValues, profileValues,
      "server listing validation drops profile values from the revision");
    assert.equal(parsed.profileStateRevision, 1);
    const listingApi = await import("../src/lib/listings.ts");
    const valuesApi = await import("../src/lib/profile-values.ts");
    listingApi.createListing(parsed, "profile-admin");
    assert.deepEqual(valuesApi.profileValuesForListings(["admin-profile"]).get("admin-profile"),
      profileValues);
    const before = profileSnapshot(api.database);
    const coreBefore = listingApi.listingBySlug("admin-profile");
    assert.throws(() => listingApi.updateListing({ ...coreBefore, profileValues: {
      ...profileValues, "vendor.ai-tools.notes": "<script>rollback sentinel</script>",
    }, profileStateRevision: 1 }, "profile-admin", coreBefore.revision), /Markdown|active|unsafe/i);
    assert.deepEqual(listingApi.listingBySlug("admin-profile"), coreBefore);
    assert.deepEqual(profileSnapshot(api.database), before);

    const slugs = ["admin-profile"];
    for (let index = 0; index < 100; index += 1) {
      const slug = `batch-${String(index).padStart(3, "0")}`;
      listingApi.createListing(parseListing(listingInput(slug, profileValues, 1)), "profile-admin");
      slugs.push(slug);
    }
    const originalPrepare = api.database.prepare;
    let valueQueries = 0;
    api.database.prepare = function countedPrepare(sql) {
      if (String(sql).includes("directory_profile_values")) valueQueries += 1;
      return originalPrepare.call(this, sql);
    };
    let hydrated;
    try { hydrated = listingApi.allListings(); }
    finally { api.database.prepare = originalPrepare; }
    assert.equal(hydrated.length, 101);
    assert.ok(hydrated.every((listing) => listing.profileValues?.["vendor.ai-tools.pricing-model"] === "paid"));
    assert.ok(valueQueries <= 2, `listing hydration issued ${valueQueries} profile-value queries`);
  });

  await t.test("renders accessible type controls without disclosing protected fields", async () => {
    const api = await profileTestContext();
    resetProfileTables(api.database);
    activate(api, authoringProfile(), 0);
    const modulePath = join(repository, "src/components/profile-field-editor.tsx");
    assert.ok(existsSync(modulePath), "generated profile field editor is missing");
    const React = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { ProfileFieldEditor } = await import(pathToFileURL(modulePath).href);
    const profile = api.parseDirectoryProfileDefinition(authoringProfile());
    const operatorHtml = renderToStaticMarkup(React.createElement(ProfileFieldEditor, {
      fields: profile.fields, values: completeProfileValues(), authority: "operator",
      mediaEndpoint: "/api/profile-media/profile-values", errors: {}, onChange() {},
    }));
    for (const text of ["Tagline help", "Notes help", "Open source", "Team size",
      "Rating", "Starting price", "Pricing model", "Platforms", "Documentation",
      "Launched", "Updated", "Availability", "Setup time", "Headquarters",
      "Screenshot", "Integrations", "Add integration", "Move integration-slack up",
      "Remove integration-slack"]) assert.match(operatorHtml, new RegExp(text, "i"));
    for (const type of ["checkbox", "number", "url", "date", "datetime-local"]) {
      assert.match(operatorHtml, new RegExp(`type=["']${type}["']`, "i"));
    }
    assert.match(operatorHtml, /<textarea/i);
    assert.match(operatorHtml, /aria-describedby=/i);
    assert.match(operatorHtml, /<fieldset/i);
    const ownerHtml = renderToStaticMarkup(React.createElement(ProfileFieldEditor, {
      fields: profile.fields, values: completeProfileValues({ includeOperator: false,
        includeSystem: false }), authority: "owner", mediaEndpoint: "/api/profile-media/profile-values",
      errors: {}, onChange() {},
    }));
    assert.doesNotMatch(ownerHtml, /Tagline help|Updated help/);
  });

  await t.test("publishes one exact owner snapshot and rejects stale or unauthorized moderation", async () => {
    const api = await profileTestContext();
    resetProfileTables(api.database);
    activate(api, authoringProfile(), 0);
    api.database.prepare("INSERT INTO categories (name) VALUES ('Tools')").run();
    const moderation = await import("../src/lib/moderation.ts");
    const valuesApi = await import("../src/lib/profile-values.ts");
    const ownerValues = completeProfileValues({ includeOperator: false, includeSystem: false });
    delete ownerValues["vendor.ai-tools.screenshot"];
    moderation.createOwnerListing("profile-owner", listingInput("owner-profile", ownerValues, 1));
    assert.throws(() => moderation.updateOwnerListing("profile-owner", "owner-profile", {
      profileValues: { ...ownerValues, "vendor.ai-tools.tagline": "Forbidden owner edit" },
      profileStateRevision: 1,
    }), /authority|operator|permission/i);
    const proposedValues = { ...ownerValues, "vendor.ai-tools.team-size": 77 };
    moderation.updateOwnerListing("profile-owner", "owner-profile", {
      profileValues: proposedValues, profileStateRevision: 1,
    });
    const submission = moderation.submitOwnerListing("profile-owner", "owner-profile");
    const stored = JSON.parse(api.database.prepare("SELECT payload FROM submissions WHERE id = ?")
      .get(submission.id).payload);
    assert.deepEqual(stored.profileValues, proposedValues);
    assert.equal(stored.profileStateRevision, 1);
    const nextProfile = authoringProfile({ version: "1.1.0" });
    activate(api, nextProfile, 1);
    const before = profileSnapshot(api.database);
    const listingBefore = api.database.prepare("SELECT * FROM listings WHERE slug = 'owner-profile'").get();
    for (const actor of ["profile-owner", "profile-banned", "profile-unverified"]) {
      assert.throws(() => moderation.decideSubmission(submission.id, actor, "approve", "No"),
        /Forbidden|permission|verified|stale|profile/i);
      assert.deepEqual(api.database.prepare("SELECT * FROM listings WHERE slug = 'owner-profile'").get(),
        listingBefore);
      assert.deepEqual(profileSnapshot(api.database), before);
    }
    assert.throws(() => moderation.decideSubmission(submission.id, "profile-moderator", "approve", "Good"),
      /profile|schema|revision|changed/i);
    assert.equal(api.database.prepare("SELECT status FROM submissions WHERE id = ?")
      .get(submission.id).status, "pending");
    moderation.decideSubmission(submission.id, "profile-moderator", "reject", "Refresh profile");
    moderation.updateOwnerListing("profile-owner", "owner-profile", {
      profileValues: proposedValues, profileStateRevision: 2,
    });
    const current = moderation.submitOwnerListing("profile-owner", "owner-profile");
    moderation.decideSubmission(current.id, "profile-moderator", "approve", "Good");
    assert.deepEqual(valuesApi.profileValuesForListings(["owner-profile"])
      .get("owner-profile"), proposedValues);
    assert.equal(api.database.prepare(`SELECT COUNT(*) AS count FROM audit_events
      WHERE action = 'moderation.approve' AND target = 'owner-profile'`).get().count, 1);

    const rejectedValues = { ...proposedValues, "vendor.ai-tools.team-size": 88 };
    moderation.updateOwnerListing("profile-owner", "owner-profile", {
      profileValues: rejectedValues, profileStateRevision: 2,
    });
    const rejected = moderation.submitOwnerListing("profile-owner", "owner-profile");
    moderation.decideSubmission(rejected.id, "profile-moderator", "reject", "Needs evidence");
    assert.deepEqual(JSON.parse(api.database.prepare("SELECT payload FROM owner_drafts WHERE slug = ?")
      .get("owner-profile").payload).profileValues, rejectedValues);
    assert.deepEqual(valuesApi.profileValuesForListings(["owner-profile"])
      .get("owner-profile"), proposedValues);
  });
});

requirementTest("PRF-003 parses bounded public profile facets and stable sorts", async () => {
  const modulePath = join(repository, "src/lib/profile-discovery.ts");
  assert.ok(existsSync(modulePath),
    "generic server-rendered profile discovery and facet support is missing");
  const discovery = await import(modulePath);
  assert.equal(typeof discovery.parseProfileDirectoryQuery, "function",
    "profile discovery does not expose bounded GET query validation");
  assert.equal(typeof discovery.searchProfileDirectory, "function",
    "profile discovery does not expose indexed facet and sort execution");
});

requirementTest("PRF-004 validates profile-bearing add-on manifests", () => {
  const fixture = join(repository, "fixtures/addons/reference-addon/directory-addon.json");
  const manifest = JSON.parse(readFileSync(fixture, "utf8"));
  manifest.profiles = [{
    id: "ai-tools",
    version: "1.0.0",
    schema: "src/ai-tools.profile.json",
  }];
  manifest.files.push("src/ai-tools.profile.json");
  const parsed = parseManifest(manifest);
  assert.deepEqual(parsed.profiles, manifest.profiles,
    "add-on validation does not preserve versioned profile declarations");
});
