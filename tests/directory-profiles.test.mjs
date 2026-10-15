import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  readlinkSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import Database from "better-sqlite3";
import { chromium } from "playwright-core";
import { parseListing } from "../src/lib/catalog-input.ts";
import { canonicalJson, sha256 } from "../scripts/addons/manifest.mjs";
import { canonicalProfileJson, profileDigest } from "../scripts/addons/profile-schema.mjs";

const repository = resolve(import.meta.dirname, "..");
const selectedRequirement = process.env.PROFILE_REQUIREMENT;

function requirementTest(name, body) {
  if (!selectedRequirement || name.startsWith(selectedRequirement)) test(name, body);
}

function command(cwd, executable, args, env = {}, timeout = 180_000) {
  return spawnSync(executable, args, {
    cwd,
    encoding: "utf8",
    timeout,
    env: { ...process.env, CI: "1", ...env },
  });
}

function addonCommand(cwd, args, env = {}) {
  return command(cwd, process.execPath, ["scripts/addons.mjs", ...args], env);
}

function expectCommandSuccess(result, label) {
  assert.equal(result.status, 0, `${label}: ${result.stderr || result.stdout}`);
}

function expectCommandFailure(result, label, pattern) {
  assert.notEqual(result.status, 0, `${label} unexpectedly succeeded`);
  if (pattern) assert.match(`${result.stderr}\n${result.stdout}`, pattern, label);
}

function fileSnapshot(path) {
  if (!existsSync(path)) return null;
  const status = lstatSync(path);
  assert.ok(status.isFile() && !status.isSymbolicLink(), `${path} must remain a regular file`);
  return { bytes: status.size, digest: sha256(readFileSync(path)) };
}

function runWithoutDatabaseMutation(cwd, args, databaseFile, env = {}) {
  const before = fileSnapshot(databaseFile);
  const result = addonCommand(cwd, args, {
    DATABASE_URL: `file:${databaseFile}`,
    ...env,
  });
  assert.deepEqual(fileSnapshot(databaseFile), before,
    `${args[0]} opened or changed the operator database`);
  return result;
}

const ignoredCopyRoots = new Set([
  ".git", ".next", ".runtime", ".claude", ".gstack", ".superpowers", "node_modules",
]);

function copyStarter(destination) {
  cpSync(repository, destination, {
    recursive: true,
    filter(source) {
      const path = relative(repository, source);
      if (!path) return true;
      return !ignoredCopyRoots.has(path.split(sep)[0]);
    },
  });
  symlinkSync(join(repository, "node_modules"), join(destination, "node_modules"), "dir");
}

function treeSnapshot(root) {
  const result = [];
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      const path = relative(root, absolute).split(sep).join("/");
      if (ignoredCopyRoots.has(path.split("/")[0])) continue;
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isSymbolicLink()) result.push([path, `link:${readlinkSync(absolute)}`]);
      else result.push([path, sha256(readFileSync(absolute))]);
    }
  }
  visit(root);
  return result.sort(([left], [right]) => left.localeCompare(right));
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
      { countries: ["CA", "US"] }), facet: { label: "Location", mode: "all" } },
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
    DELETE FROM agent_imports;
    DELETE FROM agent_staging_usage;
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
  textValue = null, integerValue = 1299, currency = "USD", mediaId = null, archivedAt = null,
} = {}) {
  database.prepare(`INSERT INTO directory_profile_values
    (listing_slug, profile_id, definition_version, field_key, item_id, child_key,
      position, value_type, text_value, integer_value, currency, media_id, archived_at, updated_at)
    VALUES (?, ?, ?, ?, ?, '', 0, ?, ?, ?, ?, ?, ?, ?)`)
    .run(slug, profileId, version, fieldKey, itemId, valueType, textValue,
      integerValue, currency, mediaId, archivedAt, "2026-10-14T00:00:00.000Z");
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

  await t.test("rejects an add-on that claims the operator-owned site profile slot", async () => {
    const api = await profileTestContext();
    resetProfileTables(api.database);
    const claimed = completeProfile({ id: "site.local", name: "Claimed site profile" });
    claimed.fields = claimed.fields.map((field) => ({
      ...field,
      key: field.key.replace("vendor.ai-tools", "site"),
    }));
    const before = profileSnapshot(api.database);
    assert.throws(() => api.activateDirectoryProfile({
      definition: claimed,
      sourceKind: "addon",
      sourceId: "hostile-addon",
      expectedRevision: 0,
      actorUserId: "profile-admin",
    }), /site|source|operator|reserved/i);
    assert.deepEqual(profileSnapshot(api.database), before);
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

  await t.test("rejects an aggregate mapping that exceeds the retained target constraints", async () => {
    const api = await profileTestContext();
    resetProfileTables(api.database);
    const original = completeProfile();
    const integrations = original.fields.find(({ key }) => key === "vendor.ai-tools.integrations");
    original.fields.push({ ...structuredClone(integrations), key: "vendor.ai-tools.channels",
      label: "Channels" });
    activate(api, original, 0);
    const groupItems = (prefix) => Array.from({ length: 20 }, (_, index) => ({
      id: `${prefix}-${index}`,
      values: { name: `${prefix} ${index}` },
    }));
    const values = completeProfileValues({ includeSystem: false });
    delete values["vendor.ai-tools.screenshot"];
    values["vendor.ai-tools.integrations"] = groupItems("integration");
    values["vendor.ai-tools.channels"] = groupItems("channel");
    const listingApi = await import("../src/lib/listings.ts");
    listingApi.createListing(parseListing(listingInput("aggregate-profile", values, 1)),
      "profile-admin");
    const next = completeProfile({ version: "2.0.0" });
    const before = profileSnapshot(api.database);
    assert.throws(() => activate(api, next, 1, { fields: {
      "vendor.ai-tools.channels": {
        action: "map", to: "vendor.ai-tools.integrations", onInvalid: "reject",
      },
    }, defaults: {} }), /migration|aggregate|group items|too many/i);
    assert.deepEqual(profileSnapshot(api.database), before);
  });

  await t.test("keeps media ownership aligned when a media field is mapped", async () => {
    const api = await profileTestContext();
    resetProfileTables(api.database);
    activate(api, completeProfile(), 0);
    insertListing(api.database);
    const mediaId = "123e4567-e89b-12d3-a456-426614174000";
    insertProfileMedia(api.database, { id: mediaId, state: "public" });
    insertValue(api.database, { fieldKey: "vendor.ai-tools.screenshot", valueType: "media",
      integerValue: null, currency: null, mediaId });
    const renamed = structuredClone(completeProfile({ version: "2.0.0" }));
    const mediaField = renamed.fields.find(({ key }) => key === "vendor.ai-tools.screenshot");
    mediaField.key = "vendor.ai-tools.hero-image";
    mediaField.label = "Hero image";
    activate(api, renamed, 1, { fields: {
      "vendor.ai-tools.screenshot": {
        action: "map", to: "vendor.ai-tools.hero-image", onInvalid: "reject",
      },
    }, defaults: {} });
    assert.deepEqual(api.database.prepare(`SELECT field_key, state
      FROM directory_profile_media WHERE asset_id = ?`).get(mediaId),
    { field_key: "vendor.ai-tools.hero-image", state: "public" });
    const mediaApi = await import("../src/lib/media.ts");
    assert.equal(mediaApi.publicProfileMediaAssets([mediaId]).has(mediaId), true);
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

  await t.test("requires protected fields in complete records and applies trusted defaults", async () => {
    const api = await profileTestContext();
    resetProfileTables(api.database);
    const requiredSystem = authoringProfile();
    requiredSystem.fields.find(({ key }) => key === "vendor.ai-tools.system-note").required = true;
    activate(api, requiredSystem, 0);
    const values = completeProfileValues({ includeSystem: false });
    delete values["vendor.ai-tools.screenshot"];
    const listingApi = await import("../src/lib/listings.ts");
    const before = profileSnapshot(api.database);
    assert.throws(() => listingApi.createListing(parseListing(listingInput(
      "missing-required-system", values, 1, { status: "published" })), "profile-admin"),
    /system-note|required/i);
    assert.equal(listingApi.listingBySlug("missing-required-system"), undefined);
    assert.deepEqual(profileSnapshot(api.database), before);

    resetProfileTables(api.database);
    const defaultedSystem = authoringProfile();
    const systemField = defaultedSystem.fields.find(
      ({ key }) => key === "vendor.ai-tools.system-note");
    systemField.required = true;
    systemField.default = "Trusted classification";
    activate(api, defaultedSystem, 0);
    const created = listingApi.createListing(parseListing(listingInput(
      "defaulted-required-system", values, 1, { status: "published" })), "profile-admin");
    assert.equal(created.profileValues["vendor.ai-tools.system-note"], "Trusted classification");
  });

  await t.test("preserves protected values while authorizing only operator changes", async () => {
    const api = await profileTestContext();
    resetProfileTables(api.database);
    activate(api, authoringProfile(), 0);
    const operatorValues = completeProfileValues({ includeSystem: false });
    delete operatorValues["vendor.ai-tools.screenshot"];
    const listingApi = await import("../src/lib/listings.ts");
    const valuesApi = await import("../src/lib/profile-values.ts");
    listingApi.createListing(parseListing(listingInput("protected-lifecycle", operatorValues, 1)),
      "profile-admin");
    const trustedValues = valuesApi.validateProfileValues({ ...operatorValues,
      "vendor.ai-tools.system-note": "Trusted workflow value" }, {
      profiles: api.activeDirectoryProfiles(), authority: "system",
      listingSlug: "protected-lifecycle", actorUserId: "profile-admin", requireComplete: true,
    });
    valuesApi.replaceListingProfileValues({ listingSlug: "protected-lifecycle",
      values: trustedValues, profiles: api.activeDirectoryProfiles() });

    const beforePublish = listingApi.listingBySlug("protected-lifecycle");
    const published = listingApi.updateListing({ ...beforePublish, status: "published" },
      "profile-catalog", beforePublish.revision);
    assert.equal(published.profileValues["vendor.ai-tools.system-note"], "Trusted workflow value");
    const updated = listingApi.updateListing({ ...published, profileValues: {
      ...published.profileValues, "vendor.ai-tools.tagline": "Operator correction",
    } }, "profile-catalog", published.revision);
    assert.equal(updated.profileValues["vendor.ai-tools.tagline"], "Operator correction");
    assert.equal(updated.profileValues["vendor.ai-tools.system-note"], "Trusted workflow value");

    const beforeTamper = profileSnapshot(api.database);
    assert.throws(() => listingApi.updateListing({ ...updated, profileValues: {
      ...updated.profileValues, "vendor.ai-tools.system-note": "Operator tamper",
    } }, "profile-catalog", updated.revision), /system-note|authority|permission/i);
    assert.deepEqual(profileSnapshot(api.database), beforeTamper);
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
    assert.match(operatorHtml,
      /<input(?=[^>]*type="file")(?=[^>]*aria-label="Screenshot image file")[^>]*>/i,
      "profile media file input needs a field-specific accessible label");
    const ownerHtml = renderToStaticMarkup(React.createElement(ProfileFieldEditor, {
      fields: profile.fields, values: completeProfileValues({ includeOperator: false,
        includeSystem: false }), authority: "owner", mediaEndpoint: "/api/profile-media/profile-values",
      errors: {}, onChange() {},
    }));
    assert.doesNotMatch(ownerHtml, /Tagline help|Updated help/);
  });

  await t.test("retains removed private values for staff until an explicit purge", async () => {
    const api = await profileTestContext();
    resetProfileTables(api.database);
    activate(api, authoringProfile(), 0);
    const values = completeProfileValues({ includeSystem: false });
    delete values["vendor.ai-tools.screenshot"];
    const listingApi = await import("../src/lib/listings.ts");
    const valuesApi = await import("../src/lib/profile-values.ts");
    listingApi.createListing(parseListing(listingInput("archived-profile", values, 1)),
      "profile-admin");
    const next = authoringProfile({ version: "2.0.0" });
    next.fields = next.fields.filter(({ key }) => key !== "vendor.ai-tools.notes");
    activate(api, next, 1, { fields: {
      "vendor.ai-tools.notes": { action: "archive" },
    }, defaults: {} });
    assert.equal(valuesApi.profileValuesForListings(["archived-profile"])
      .get("archived-profile")["vendor.ai-tools.notes"], undefined);
    assert.equal(valuesApi.profileValuesForListings(["archived-profile"], {
      includePrivate: true, includeArchived: true,
    }).get("archived-profile")["vendor.ai-tools.notes"], "**Private** owner notes");
    assert.equal(api.database.prepare(`SELECT COUNT(*) AS count FROM directory_profile_values
      WHERE listing_slug = 'archived-profile' AND field_key = 'vendor.ai-tools.notes'
        AND archived_at IS NOT NULL`).get().count, 1);
  });

  await t.test("keeps profile media private and promotes only the approved snapshot", async () => {
    const api = await profileTestContext();
    resetProfileTables(api.database);
    activate(api, authoringProfile(), 0);
    api.database.prepare("INSERT INTO categories (name) VALUES ('Tools')").run();
    const moderation = await import("../src/lib/moderation.ts");
    const media = await import("../src/lib/media.ts");
    assert.equal(typeof media.uploadProfileMedia, "function", "profile media upload is missing");
    const ownerValues = completeProfileValues({ includeOperator: false, includeSystem: false });
    delete ownerValues["vendor.ai-tools.screenshot"];
    moderation.createOwnerListing("profile-owner",
      listingInput("profile-media", ownerValues, 1));
    const sharp = (await import("sharp")).default;
    const bytes = await sharp({ create: { width: 8, height: 8, channels: 3,
      background: "#3557ff" } }).png().toBuffer();
    const upload = (itemId) => media.uploadProfileMedia({ listingSlug: "profile-media",
      fieldKey: "vendor.ai-tools.screenshot", itemId, actorUserId: "profile-owner",
      actorRole: null, bytes, mimeType: "image/png", alt: `Profile ${itemId}` });
    assert.rejects(() => media.uploadProfileMedia({ listingSlug: "profile-media",
      fieldKey: "vendor.ai-tools.screenshot", itemId: "unowned", actorUserId: "profile-catalog",
      actorRole: "catalog", bytes, mimeType: "image/png", alt: "Unowned" }),
    /permission|owner|not found|forbidden/i);
    const selected = await upload("selected");
    const abandoned = await upload("abandoned");
    assert.equal(media.publicMediaAsset(selected.id), undefined);
    moderation.updateOwnerListing("profile-owner", "profile-media", {
      profileValues: { ...ownerValues, "vendor.ai-tools.screenshot": selected.id },
      profileStateRevision: 1,
    });
    const submission = moderation.submitOwnerListing("profile-owner", "profile-media");
    moderation.decideSubmission(submission.id, "profile-moderator", "approve", "Good");
    assert.equal(media.publicMediaAsset(selected.id)?.id, selected.id);
    assert.equal(media.publicMediaAsset(abandoned.id), undefined);
    assert.equal(api.database.prepare(`SELECT state FROM directory_profile_media
      WHERE asset_id = ?`).get(selected.id).state, "public");
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
    api.database.prepare("UPDATE \"user\" SET banned = 1 WHERE id = 'profile-owner'").run();
    assert.throws(() => moderation.updateOwnerListing("profile-owner", "owner-profile", {
      profileValues: ownerValues, profileStateRevision: 1,
    }), /Forbidden|banned|suspended|verified/i);
    api.database.prepare("UPDATE \"user\" SET banned = 0 WHERE id = 'profile-owner'").run();
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

function discoveryProfile() {
  const profile = authoringProfile();
  const field = (key) => profile.fields.find((candidate) => candidate.key === key);
  field("vendor.ai-tools.tagline").placement = "card";
  field("vendor.ai-tools.pricing-model").placement = "badge";
  field("vendor.ai-tools.team-size").facet = { label: "Team size", mode: "any" };
  field("vendor.ai-tools.rating").facet = { label: "Rating", mode: "any" };
  field("vendor.ai-tools.setup-time").sort = { label: "Setup time", directions: ["asc", "desc"] };
  return profile;
}

function publicProfileValues(index, overrides = {}) {
  const values = completeProfileValues({ includeSystem: false, mediaId: undefined });
  delete values["vendor.ai-tools.screenshot"];
  return {
    ...values,
    "vendor.ai-tools.tagline": index === 0 ? "Neural canvas exact phrase" : `Tool profile ${index}`,
    "vendor.ai-tools.notes": `PRIVATE_PROFILE_SENTINEL_${index}`,
    "vendor.ai-tools.open-source": index % 2 === 0,
    "vendor.ai-tools.team-size": index < 3 ? [10, 20, 30][index] : 100 + index,
    "vendor.ai-tools.rating": index < 3 ? ["4.50", "3.00", "4.75"][index] : "2.50",
    "vendor.ai-tools.starting-price": { amountMinor: index < 3 ? [1000, 2000, 1500][index] : 5000,
      currency: index === 2 ? "EUR" : "USD" },
    "vendor.ai-tools.pricing-model": index === 1 ? "free" : "paid",
    "vendor.ai-tools.platforms": index === 0 ? ["web", "mac"] : index === 1 ? ["web"]
      : index === 2 ? ["mac"] : ["web", "mac"],
    "vendor.ai-tools.launched": index < 3 ? ["2025-01-10", "2024-01-10", "2025-06-10"][index] : "2023-01-01",
    "vendor.ai-tools.availability": index === 0
      ? { start: "2026-01-01", end: "2026-01-31" }
      : { start: "2026-02-01", end: "2026-02-28" },
    "vendor.ai-tools.setup-time": index < 3 ? [3600, 7200, 1800][index] : 9000,
    "vendor.ai-tools.headquarters": index === 0
      ? { countryCode: "US", region: "NY", locality: "New York" }
      : index === 1 ? { countryCode: "US", region: "CA", locality: "San Francisco" }
        : { countryCode: "CA", region: "ON", locality: "Toronto" },
    ...overrides,
  };
}

async function setupDiscoveryCatalog() {
  const api = await profileTestContext();
  resetProfileTables(api.database);
  activate(api, discoveryProfile(), 0);
  const listingApi = await import("../src/lib/listings.ts");
  for (let index = 0; index < 15; index += 1) {
    const slug = index === 0 ? "alpha" : index === 1 ? "beta" : index === 2 ? "gamma"
      : `page-${String(index).padStart(2, "0")}`;
    const parsed = parseListing(listingInput(slug, publicProfileValues(index), 1, {
      name: index < 3 ? "A stable name" : `Page ${String(index).padStart(2, "0")}`,
      summary: index === 0 ? "Core alpha summary" : `Core summary ${index}`,
      status: "published",
    }));
    assert.ok(parsed);
    listingApi.createListing(parsed, "profile-admin");
  }
  for (const [slug, status, sentinel] of [
    ["hidden-draft-profile", "draft", "DRAFT_PROFILE_SENTINEL"],
    ["hidden-suspended-profile", "suspended", "SUSPENDED_PROFILE_SENTINEL"],
    ["hidden-banned-profile", "published", "BANNED_PROFILE_SENTINEL"],
  ]) {
    const parsed = parseListing(listingInput(slug, publicProfileValues(0, {
      "vendor.ai-tools.tagline": sentinel,
    }), 1, { status }));
    assert.ok(parsed);
    listingApi.createListing(parsed, "profile-admin");
  }
  api.database.prepare(`UPDATE listings SET owner_user_id = 'profile-banned'
    WHERE slug = 'hidden-banned-profile'`).run();
  return api;
}

async function discoveryModule() {
  const modulePath = join(repository, "src/lib/profile-discovery.ts");
  assert.ok(existsSync(modulePath),
    "generic server-rendered profile discovery and facet support is missing");
  const discovery = await import(pathToFileURL(modulePath).href);
  for (const name of ["parseProfileDirectoryQuery", "serializeProfileDirectoryQuery",
    "searchProfileDirectory"]) assert.equal(typeof discovery[name], "function",
    `profile discovery does not expose ${name}`);
  return discovery;
}

async function startProfileApp() {
  const build = spawnSync("npm", ["run", "build"], { cwd: repository, encoding: "utf8",
    timeout: 180_000, env: { ...process.env, SITE_URL: "http://127.0.0.1:38763",
      BETTER_AUTH_URL: "http://127.0.0.1:38763",
      BETTER_AUTH_SECRET: "profile-browser-secret-at-least-32-characters-long" } });
  assert.equal(build.status, 0, build.stderr || build.stdout);
  const origin = "http://127.0.0.1:38763";
  const child = spawn(join(repository, "node_modules/.bin/next"), ["start", "-p", "38763"], { cwd: repository,
    stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, SITE_URL: origin,
      BETTER_AUTH_URL: origin,
      BETTER_AUTH_SECRET: "profile-browser-secret-at-least-32-characters-long" } });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) assert.fail(`profile browser server exited early\n${output}`);
    try {
      const response = await fetch(`${origin}/listings`);
      if (response.ok) return { origin, child, output: () => output };
    } catch {}
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  child.kill("SIGTERM");
  assert.fail(`profile browser server did not start\n${output}`);
}

requirementTest("PRF-003 parses bounded public profile facets and stable sorts", async (t) => {
  await t.test("rejects hidden, unknown, malformed, duplicate, and excessive query state generically", async () => {
    const discovery = await discoveryModule();
    const profiles = (await setupDiscoveryCatalog()).activeDirectoryProfiles();
    const valid = discovery.parseProfileDirectoryQuery({
      "facet.vendor.ai-tools.platforms": ["mac", "web"],
      "min.vendor.ai-tools.starting-price": "USD:1000",
      "max.vendor.ai-tools.starting-price": "USD:2500",
      sort: "vendor.ai-tools.team-size:desc", page: "2",
    }, profiles);
    assert.equal(valid.invalid, false);
    assert.deepEqual(valid.facets["vendor.ai-tools.platforms"].values, ["web", "mac"]);
    assert.equal(valid.page, 2);
    assert.equal(valid.sort.fieldKey, "vendor.ai-tools.team-size");
    assert.equal(valid.sort.direction, "desc");
    assert.equal(discovery.serializeProfileDirectoryQuery(valid, 3).toString(),
      "min.vendor.ai-tools.starting-price=USD%3A1000&max.vendor.ai-tools.starting-price=USD%3A2500&facet.vendor.ai-tools.platforms=web&facet.vendor.ai-tools.platforms=mac&sort=vendor.ai-tools.team-size%3Adesc&page=3");

    const invalidInputs = [
      { q: "x".repeat(4097) },
      Object.fromEntries(Array.from({ length: 13 }, (_, index) => [`facet.unknown-${index}`, "x"])),
      { "facet.vendor.ai-tools.platforms": Array.from({ length: 21 }, (_, index) => `value-${index}`) },
      { "min.vendor.ai-tools.team-size": ["1", "2"] },
      { sort: "vendor.ai-tools.notes:asc" },
      { "facet.vendor.ai-tools.notes": "PRIVATE_QUERY_SENTINEL" },
      { "min.vendor.ai-tools.launched": "not-a-date" },
      { "min.vendor.ai-tools.starting-price": "usd-no-amount" },
      { "facet.vendor.ai-tools.headquarters": "US|NY|x|unexpected" },
    ];
    for (const input of invalidInputs) {
      const parsed = discovery.parseProfileDirectoryQuery(input, profiles);
      assert.equal(parsed.invalid, true, JSON.stringify(input));
      assert.doesNotMatch(JSON.stringify(parsed), /Notes help|PRIVATE_QUERY_SENTINEL|unknown-0/i);
    }
  });

  await t.test("filters every facet family with AND semantics, stable sorts, privacy, and indexed SQL", async () => {
    const api = await setupDiscoveryCatalog();
    const discovery = await discoveryModule();
    const profiles = api.activeDirectoryProfiles();
    const slugs = (input) => discovery.searchProfileDirectory(
      discovery.parseProfileDirectoryQuery(input, profiles)).listings.map(({ slug }) => slug);
    assert.deepEqual(slugs({ "facet.vendor.ai-tools.platforms": ["web", "mac"],
      "max.vendor.ai-tools.team-size": "30" }), ["alpha"]);
    assert.deepEqual(slugs({ "facet.vendor.ai-tools.pricing-model": "free" }), ["beta"]);
    assert.deepEqual(slugs({ "facet.vendor.ai-tools.open-source": "true",
      "min.vendor.ai-tools.team-size": "10", "max.vendor.ai-tools.team-size": "10" }), ["alpha"]);
    assert.deepEqual(slugs({ "min.vendor.ai-tools.rating": "4.00",
      "max.vendor.ai-tools.rating": "4.60" }), ["alpha"]);
    assert.deepEqual(slugs({ "min.vendor.ai-tools.starting-price": "USD:900",
      "max.vendor.ai-tools.starting-price": "USD:1200" }), ["alpha"]);
    assert.deepEqual(slugs({ "min.vendor.ai-tools.launched": "2025-01-01",
      "max.vendor.ai-tools.launched": "2025-02-01" }), ["alpha"]);
    assert.deepEqual(slugs({ "min.vendor.ai-tools.availability": "2026-01-15",
      "max.vendor.ai-tools.availability": "2026-01-20" }), ["alpha"]);
    assert.deepEqual(slugs({ "min.vendor.ai-tools.setup-time": "3000",
      "max.vendor.ai-tools.setup-time": "4000" }), ["alpha"]);
    assert.deepEqual(slugs({ "facet.vendor.ai-tools.headquarters": "US|NY|New York" }), ["alpha"]);
    assert.deepEqual(slugs({ "facet.vendor.ai-tools.headquarters":
      ["US|NY|New York", "US|CA|San Francisco"] }), []);
    assert.deepEqual(slugs({ q: "Neural canvas exact phrase" }), ["alpha"]);
    assert.deepEqual(slugs({ q: "PRIVATE_PROFILE_SENTINEL_0" }), []);
    for (const sentinel of ["DRAFT_PROFILE_SENTINEL", "SUSPENDED_PROFILE_SENTINEL",
      "BANNED_PROFILE_SENTINEL"]) assert.deepEqual(slugs({ q: sentinel }), []);
    assert.deepEqual(slugs({ sort: "vendor.ai-tools.team-size:asc" }).slice(0, 3),
      ["alpha", "beta", "gamma"]);
    assert.deepEqual(slugs({ sort: "vendor.ai-tools.team-size:desc", page: "2" }),
      ["gamma", "beta", "alpha"]);
    const page = discovery.searchProfileDirectory(discovery.parseProfileDirectoryQuery({}, profiles));
    assert.equal(page.total, 15);
    assert.equal(page.listings.length, 12);
    assert.equal(page.pages, 2);
    assert.ok(page.listings.every(({ profileValues }) =>
      !Object.keys(profileValues).includes("vendor.ai-tools.notes")));
    assert.equal(page.facetCounts["vendor.ai-tools.pricing-model"].paid, 14);

    const prepared = [];
    const originalPrepare = api.database.prepare;
    api.database.prepare = function trackedPrepare(sql) {
      prepared.push(String(sql));
      return originalPrepare.call(this, sql);
    };
    try {
      discovery.searchProfileDirectory(discovery.parseProfileDirectoryQuery({
        "min.vendor.ai-tools.team-size": "1", q: "canvas",
      }, profiles));
    } finally { api.database.prepare = originalPrepare; }
    const sql = prepared.join("\n");
    assert.match(sql, /directory_profile_values_integer/i);
    assert.match(sql, /directory_profile_search/i);
    assert.ok((sql.match(/directory_profile_values/g) ?? []).length < 20,
      "profile discovery performs unbounded per-listing value queries");

    const explain = (input) => {
      const calls = [];
      api.database.prepare = function planPrepare(statementSql) {
        const statement = originalPrepare.call(this, statementSql);
        return new Proxy(statement, { get(target, property) {
          const value = Reflect.get(target, property, target);
          if (property !== "all" && property !== "get") {
            return typeof value === "function" ? value.bind(target) : value;
          }
          return (...args) => {
            calls.push({ sql: String(statementSql), args });
            return value.apply(target, args);
          };
        } });
      };
      try {
        discovery.searchProfileDirectory(discovery.parseProfileDirectoryQuery(input, profiles));
      } finally { api.database.prepare = originalPrepare; }
      const pageCall = calls.find(({ sql: statementSql }) => /^SELECT l\.\*/.test(statementSql));
      assert.ok(pageCall, `missing page query for ${JSON.stringify(input)}`);
      return originalPrepare.call(api.database, `EXPLAIN QUERY PLAN ${pageCall.sql}`)
        .all(...pageCall.args).map(({ detail }) => detail).join("\n");
    };
    for (const [input, expectedIndex] of [
      [{ "facet.vendor.ai-tools.pricing-model": "paid" }, "directory_profile_values_text"],
      [{ "facet.vendor.ai-tools.platforms": ["web", "mac"] }, "directory_profile_values_text"],
      [{ "facet.vendor.ai-tools.open-source": "true" }, "directory_profile_values_integer"],
      [{ "min.vendor.ai-tools.team-size": "1" }, "directory_profile_values_integer"],
      [{ "min.vendor.ai-tools.rating": "1.00" }, "directory_profile_values_integer"],
      [{ "min.vendor.ai-tools.starting-price": "USD:1" }, "directory_profile_values_money"],
      [{ "min.vendor.ai-tools.launched": "2025-01-01" }, "directory_profile_values_dates"],
      [{ "min.vendor.ai-tools.availability": "2026-01-01" }, "directory_profile_values_dates"],
      [{ "min.vendor.ai-tools.setup-time": "1" }, "directory_profile_values_integer"],
      [{ "facet.vendor.ai-tools.headquarters": "US|NY|New York" },
        "directory_profile_values_location"],
      [{ q: "canvas" }, "directory_profile_search"],
    ]) assert.match(explain(input), new RegExp(expectedIndex, "i"),
      `${JSON.stringify(input)} does not use ${expectedIndex}`);
  });

  await t.test("renders public placements and alternate outputs without protected sentinels", async () => {
    const api = await setupDiscoveryCatalog();
    const profileMediaId = "223e4567-e89b-12d3-a456-426614174000";
    insertProfileMedia(api.database, { id: profileMediaId, slug: "alpha",
      fieldKey: "vendor.ai-tools.screenshot", state: "public" });
    api.database.prepare(`INSERT INTO directory_profile_values
      (listing_slug, profile_id, definition_version, field_key, item_id, child_key,
        position, value_type, media_id, archived_at, updated_at)
      VALUES ('alpha', 'vendor.ai-tools', '1.0.0', 'vendor.ai-tools.screenshot',
        'value', '', 0, 'media', ?, NULL, ?)`)
      .run(profileMediaId, "2026-10-14T00:00:00.000Z");
    const facetsPath = join(repository, "src/components/profile-facets.tsx");
    assert.ok(existsSync(facetsPath), "server-rendered profile facet controls are missing");
    const React = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { ProfileValuesView } = await import("../src/components/profile-values-view.tsx");
    const profile = discoveryProfile();
    const html = renderToStaticMarkup(React.createElement(ProfileValuesView, {
      fields: profile.fields, values: publicProfileValues(0, {
        "vendor.ai-tools.screenshot": profileMediaId,
      }), mode: "public",
    }));
    for (const visible of ["Neural canvas exact phrase", "Paid", "Web", "macOS",
      "$10.00", "1 hour", "New York", "Slack"]) assert.ok(
      html.toLowerCase().includes(visible.toLowerCase()), `${visible} is not rendered`);
    assert.doesNotMatch(html, /PRIVATE_PROFILE_SENTINEL|System note|<script/i);
    assert.match(html, /dateTime=|datetime=/i);
    assert.match(html, /rel="noopener noreferrer"/i);
    assert.match(html, /alt="Profile image"/i);
    const compact = renderToStaticMarkup(React.createElement(ProfileValuesView, {
      fields: profile.fields, values: publicProfileValues(0), mode: "public",
      placements: ["card", "badge"],
    }));
    assert.match(compact, /Neural canvas exact phrase|Paid/i);
    assert.doesNotMatch(compact, /Team size|Headquarters|Slack/i);
    const hostileProfile = structuredClone(profile);
    const hostileNotes = hostileProfile.fields.find(({ key }) => key === "vendor.ai-tools.notes");
    hostileNotes.visibility = "public";
    hostileNotes.placement = "detail";
    const hostile = renderToStaticMarkup(React.createElement(ProfileValuesView, {
      fields: hostileProfile.fields, values: publicProfileValues(0, {
        "vendor.ai-tools.notes": "<script>alert(1)</script> [unsafe](javascript:alert(2))",
        "vendor.ai-tools.docs": "javascript:alert(3)",
      }), mode: "public",
    }));
    assert.doesNotMatch(hostile, /<script|javascript:|href="javascript/i);
    const { listingMarkdown } = await import("../src/lib/markdown-twins.ts");
    const listing = (await import("../src/lib/listings.ts")).publishedListingBySlug("alpha");
    const markdown = listingMarkdown(listing);
    assert.match(markdown, /Neural canvas exact phrase/);
    assert.doesNotMatch(markdown, /PRIVATE_PROFILE_SENTINEL|system-note/i);
    for (const path of ["src/app/listings/page.tsx", "src/app/listings/[slug]/page.tsx",
      "src/app/markdown/listings/[slug]/route.ts"]) {
      assert.match(readFileSync(join(repository, path), "utf8"), /Profile|profile/,
        `${path} does not consume the public profile projection`);
    }
  });

  await t.test("works without JavaScript, preserves GET state, supports keyboard use, and fits 320 pixels", async () => {
    await setupDiscoveryCatalog();
    assert.ok(existsSync(join(repository, "src/components/profile-facets.tsx")),
      "browser discovery controls are missing");
    const { origin, child, output: serverOutput } = await startProfileApp();
    const browser = await chromium.launch({ headless: true,
      ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: "chrome" }),
      args: ["--no-sandbox"] });
    try {
      const noScript = await browser.newContext({ javaScriptEnabled: false });
      const page = await noScript.newPage();
      await page.goto(`${origin}/listings?facet.vendor.ai-tools.platforms=web&facet.vendor.ai-tools.platforms=mac`);
      assert.match(await page.locator("main").innerText(), /alpha/i);
      assert.doesNotMatch(await page.locator("main").innerText(), /PRIVATE_PROFILE_SENTINEL/);
      const next = page.getByRole("link", { name: "Next" });
      if (await next.count()) assert.match(await next.getAttribute("href"),
        /facet\.vendor\.ai-tools\.platforms=web.*facet\.vendor\.ai-tools\.platforms=mac.*page=2/);
      const filteredHtml = await (await fetch(`${origin}/listings?sort=vendor.ai-tools.team-size%3Aasc`)).text();
      assert.match(filteredHtml, /noindex/i);
      assert.match(filteredHtml, /rel="canonical"[^>]+\/listings|href="[^\"]+\/listings"[^>]+rel="canonical"/i);
      for (const path of ["/listings", "/listings/alpha", "/markdown/listings/alpha", "/feed.xml"]) {
        const response = await fetch(`${origin}${path}`);
        assert.equal(response.status, 200, path);
        const body = await response.text();
        assert.doesNotMatch(body, /PRIVATE_PROFILE_SENTINEL|DRAFT_PROFILE_SENTINEL|SUSPENDED_PROFILE_SENTINEL|BANNED_PROFILE_SENTINEL/);
      }
      await noScript.close();

      const keyboard = await browser.newContext({ viewport: { width: 1024, height: 800 } });
      const keyboardPage = await keyboard.newPage();
      await keyboardPage.goto(`${origin}/listings`);
      const formControls = keyboardPage.locator("form input, form select, form button, form a");
      const controls = await formControls.count();
      await formControls.evaluateAll((elements) => elements.forEach((element, index) => {
        element.setAttribute("data-keyboard-index", String(index));
      }));
      const focused = new Set();
      await formControls.first().focus();
      for (let index = 0; index < controls * 4 && focused.size < controls; index += 1) {
        const focusedIndex = await keyboardPage.evaluate(() =>
          document.activeElement?.getAttribute("data-keyboard-index"));
        if (focusedIndex !== null) focused.add(focusedIndex);
        await keyboardPage.keyboard.press("Tab");
      }
      assert.equal(focused.size, controls, "not every discovery control is keyboard reachable");
      await keyboard.close();

      for (const colorScheme of ["light", "dark"]) {
        const narrow = await browser.newContext({ viewport: { width: 320, height: 740 }, colorScheme });
        const narrowPage = await narrow.newPage();
        for (const path of ["/listings", "/listings/alpha"]) {
          await narrowPage.goto(`${origin}${path}`);
          const width = await narrowPage.evaluate(() => document.documentElement.scrollWidth);
          assert.ok(width <= 320, `${path} overflows at 320 pixels in ${colorScheme} mode`);
        }
        await narrow.close();
      }
      assert.doesNotMatch(serverOutput(),
        /unstable value|blocking-prerender-current-time/i,
        "public directory rendering must not trigger a Next.js prerender error");
    } finally {
      await browser.close();
      child.kill("SIGTERM");
    }
  });
});

function profileForAddon(addonId, overrides = {}) {
  const definition = structuredClone(discoveryProfile());
  const previousId = definition.id;
  const id = overrides.id ?? `${addonId}.ai-tools`;
  definition.id = id;
  definition.version = overrides.version ?? "1.0.0";
  definition.name = `${addonId} AI tools`;
  definition.fields = definition.fields.map((field) => ({
    ...field,
    key: field.key.replace(previousId, id),
  }));
  return { ...definition, ...overrides, id, version: overrides.version ?? definition.version };
}

function copyProfileAddon(root, addonId, options = {}) {
  const source = join(root, addonId);
  cpSync(join(repository, "fixtures/addons/reference-addon"), source, { recursive: true });
  const manifestPath = join(source, "directory-addon.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.id = addonId;
  manifest.name = `${addonId} profile package`;
  manifest.themes = manifest.themes.map((theme) => ({
    ...theme,
    id: addonId,
    name: `${addonId} theme`,
  }));
  manifest.templates = manifest.templates.map((template) => ({
    ...template,
    id: addonId,
    name: `${addonId} template`,
  }));
  const profile = profileForAddon(addonId, options.profile ?? {});
  manifest.profiles = [{ id: profile.id, version: profile.version, schema: "src/ai-tools.profile.json" }];
  manifest.templates[0].supportedProfiles = [{ id: profile.id, range: "^1.0.0" }];
  manifest.files = [...new Set([...manifest.files, "src/ai-tools.profile.json"])];
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  for (const file of [join(source, "src/theme.ts"), join(source, "src/template.css")]) {
    let text = readFileSync(file, "utf8").replaceAll("reference-addon", addonId);
    if (file.endsWith("theme.ts")) {
      text = text.replace('name: "Reference Add-on"', `name: "${addonId} theme"`);
    }
    writeFileSync(file, text);
  }
  writeFileSync(join(source, "src/ai-tools.profile.json"), canonicalProfileJson(profile));
  return { source, manifestPath, profilePath: join(source, "src/ai-tools.profile.json"),
    manifest, profile };
}

function mutateJson(path, mutate) {
  const value = JSON.parse(readFileSync(path, "utf8"));
  mutate(value);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function seedSnapshot(database) {
  const tables = [
    "categories", "listings", "directory_profile_values", "directory_profile_seed_runs",
    "directory_profile_search",
  ];
  return Object.fromEntries(tables.map((table) =>
    [table, database.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
}

function writeInstalledSeed(root, profile, seed) {
  const addonId = profile.id.split(".")[0];
  const schemaSource = "src/ai-tools.profile.json";
  const seedSource = "seed/catalog.json";
  const schemaTarget = `src/addons/${addonId}/ai-tools.profile.json`;
  const seedTarget = `src/addons/${addonId}/seed/catalog.json`;
  mkdirSync(join(root, ".directory-starter"), { recursive: true });
  mkdirSync(join(root, `src/addons/${addonId}/seed`), { recursive: true });
  const schemaBytes = Buffer.from(canonicalProfileJson(profile));
  const seedBytes = canonicalJson(seed);
  writeFileSync(join(root, schemaTarget), schemaBytes);
  writeFileSync(join(root, seedTarget), seedBytes);
  const lock = {
    schemaVersion: 1,
    addons: [{
      id: addonId,
      name: `${addonId} profile package`,
      version: "1.0.0",
      archiveSha256: "a".repeat(64),
      manifestSha256: "b".repeat(64),
      themes: [],
      templates: [],
      profiles: [{
        id: profile.id,
        version: profile.version,
        schema: schemaSource,
        digest: profileDigest(profile),
      }],
      seed: seedSource,
      files: [
        { source: seedSource, target: seedTarget, bytes: seedBytes.length,
          sha256: sha256(seedBytes) },
        { source: schemaSource, target: schemaTarget, bytes: schemaBytes.length,
          sha256: sha256(schemaBytes) },
      ],
    }],
  };
  writeFileSync(join(root, ".directory-starter/addons.lock.json"), canonicalJson(lock));
}

function seedRecords(profile, overrides = {}) {
  const values = [0, 1, 2].map((index) => publicProfileValues(index));
  return {
    profile: { id: profile.id, version: profile.version },
    listings: values.map((profileValues, index) => ({
      slug: `seed-tool-${index + 1}`,
      title: `Seed Tool ${index + 1}`,
      summary: `Seed profile ${index + 1}`,
      description: `Typed directory profile seed record ${index + 1}.`,
      category: "Seeded tools",
      url: `https://example.com/seed-tool-${index + 1}`,
      status: "published",
      profileValues,
    })),
    ...overrides,
  };
}

function profileTableDump(database) {
  const order = {
    directory_profile_definitions: "profile_id, version",
    directory_profile_state: "id",
    directory_profile_values:
      "listing_slug, profile_id, definition_version, field_key, item_id, child_key",
    directory_profile_changes: "created_at, id",
    directory_profile_media: "asset_id",
    directory_profile_seed_runs: "addon_id, addon_version, seed_digest",
    directory_profile_search: "listing_slug, profile_id, field_key, value",
  };
  return Object.fromEntries(Object.entries(order).map(([table, clause]) =>
    [table, database.prepare(`SELECT * FROM ${table} ORDER BY ${clause}`).all()]));
}

function refreshBackupManifest(backup) {
  const manifestPath = join(backup, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  for (const file of Object.keys(manifest.hashes)) {
    const path = join(backup, file);
    if (existsSync(path)) manifest.hashes[file] = sha256(readFileSync(path));
    else delete manifest.hashes[file];
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

requirementTest("PRF-004 preserves profiles across packages, seeds, imports, and recovery", async (t) => {
  await t.test("validates profile package identity, content, bounds, and compatibility without database access",
    async (packageTest) => {
      const temporary = mkdtempSync(join(tmpdir(), "directory-profile-packages-"));
      const databaseFile = join(temporary, "operator-database-must-not-open.db");
      try {
        await packageTest.test("packs and validates a deterministic profile package", () => {
          const { source } = copyProfileAddon(temporary, "profile-package");
          const first = join(temporary, "profile-first.zip");
          const second = join(temporary, "profile-second.zip");
          expectCommandSuccess(runWithoutDatabaseMutation(repository, ["pack", source, first], databaseFile),
            "pack profile package");
          expectCommandSuccess(runWithoutDatabaseMutation(repository, ["pack", source, second], databaseFile),
            "repack profile package");
          assert.deepEqual(readFileSync(first), readFileSync(second));
          expectCommandSuccess(runWithoutDatabaseMutation(repository, ["validate", first], databaseFile),
            "validate profile package");
        });

        const invalidSources = [
          ["traversal", /unsafe|path/i, ({ manifestPath }) => mutateJson(manifestPath,
            (manifest) => { manifest.profiles[0].schema = "../outside.profile.json"; })],
          ["duplicate-id", /duplicate.*profile/i, ({ manifestPath }) => mutateJson(manifestPath,
            (manifest) => { manifest.profiles.push({ ...manifest.profiles[0] }); })],
          ["mismatched-id", /identity|profile.*id|match/i, ({ profilePath }) => mutateJson(profilePath,
            (profile) => { profile.id = "different.ai-tools"; })],
          ["mismatched-version", /version|match/i, ({ profilePath }) => mutateJson(profilePath,
            (profile) => { profile.version = "1.1.0"; })],
          ["unknown-type", /type|invalid/i, ({ profilePath }) => mutateJson(profilePath,
            (profile) => { profile.fields[0].type = "executable"; })],
          ["unsafe-default", /url|protocol|default/i, ({ profilePath }) => mutateJson(profilePath,
            (profile) => {
              profile.fields.find(({ type }) => type === "url").default = "javascript:alert(1)";
            })],
          ["invalid-constraint", /constraint|min|max|integer/i, ({ profilePath }) => mutateJson(profilePath,
            (profile) => {
              profile.fields.find(({ type }) => type === "integer").constraints = { min: 10, max: 1 };
            })],
          ["incompatible-template", /compatible|range|profile/i, ({ manifestPath }) =>
            mutateJson(manifestPath, (manifest) => {
              manifest.templates[0].supportedProfiles[0].range = "^9.0.0";
            })],
          ["reserved-site-profile", /site|reserved|operator/i,
            ({ manifestPath, profilePath }) => {
              mutateJson(manifestPath, (manifest) => {
                manifest.profiles[0].id = "site.local";
                manifest.templates[0].supportedProfiles[0].id = "site.local";
              });
              mutateJson(profilePath, (profile) => {
                const previous = profile.id;
                profile.id = "site.local";
                profile.fields = profile.fields.map((field) => ({ ...field,
                  key: field.key.replace(previous, "site") }));
              });
            }],
          ["reserved-site-namespace", /site|reserved|namespace/i,
            ({ manifestPath, profilePath }) => {
              mutateJson(manifestPath, (manifest) => {
                manifest.profiles[0].id = "site.vendor";
                manifest.templates[0].supportedProfiles[0].id = "site.vendor";
              });
              mutateJson(profilePath, (profile) => {
                const previous = profile.id;
                profile.id = "site.vendor";
                profile.fields = profile.fields.map((field) => ({ ...field,
                  key: field.key.replace(previous, "site.vendor") }));
              });
            }],
        ];
        for (const [name, pattern, corrupt] of invalidSources) {
          await packageTest.test(`rejects ${name}`, () => {
            const value = copyProfileAddon(temporary, `profile-${name}`);
            corrupt(value);
            const output = join(temporary, `${name}.zip`);
            expectCommandFailure(runWithoutDatabaseMutation(repository,
              ["pack", value.source, output], databaseFile), name, pattern);
          });
        }

        await packageTest.test("rejects a linked profile source", () => {
          const value = copyProfileAddon(temporary, "profile-symlink");
          rmSync(value.profilePath);
          symlinkSync("theme.ts", value.profilePath);
          expectCommandFailure(runWithoutDatabaseMutation(repository,
            ["pack", value.source, join(temporary, "symlink.zip")], databaseFile),
          "profile symlink", /link|regular|profile/i);
        });

        await packageTest.test("rejects an oversized profile source", () => {
          const value = copyProfileAddon(temporary, "profile-oversized");
          const bytes = readFileSync(value.profilePath);
          writeFileSync(value.profilePath, Buffer.concat([bytes.subarray(0, -2),
            Buffer.alloc(257 * 1024, 0x20), bytes.subarray(-2)]));
          expectCommandFailure(runWithoutDatabaseMutation(repository,
            ["pack", value.source, join(temporary, "oversized.zip")], databaseFile),
          "oversized profile", /profile|256|large|size/i);
        });

        await packageTest.test("rejects corrupt profile bytes", () => {
          const value = copyProfileAddon(temporary, "profile-corrupt");
          writeFileSync(value.profilePath, Buffer.from([0xff, 0xfe, 0xfd]));
          expectCommandFailure(runWithoutDatabaseMutation(repository,
            ["pack", value.source, join(temporary, "corrupt-profile.zip")], databaseFile),
          "corrupt profile", /profile|json|utf-8|utf8/i);
        });

        await packageTest.test("rejects a corrupt archive", () => {
          const value = copyProfileAddon(temporary, "profile-archive");
          const archive = join(temporary, "valid-profile.zip");
          expectCommandSuccess(runWithoutDatabaseMutation(repository,
            ["pack", value.source, archive], databaseFile), "pack corruption fixture");
          const bytes = readFileSync(archive);
          bytes[Math.floor(bytes.length / 2)] ^= 0xff;
          writeFileSync(join(temporary, "corrupt-archive.zip"), bytes);
          expectCommandFailure(runWithoutDatabaseMutation(repository,
            ["validate", join(temporary, "corrupt-archive.zip")], databaseFile),
          "corrupt archive", /archive|zip|integrity|invalid|compressed/i);
        });

        await packageTest.test("rejects an incompatible starter version", () => {
          const value = copyProfileAddon(temporary, "profile-incompatible");
          mutateJson(value.manifestPath, (manifest) => {
            manifest.compatibility.starter = ">=99.0.0";
          });
          const archive = join(temporary, "incompatible-profile.zip");
          expectCommandSuccess(runWithoutDatabaseMutation(repository,
            ["pack", value.source, archive], databaseFile), "pack incompatible profile");
          expectCommandFailure(runWithoutDatabaseMutation(repository,
            ["validate", archive], databaseFile), "incompatible starter", /compatible|starter|version/i);
        });
      } finally {
        rmSync(temporary, { recursive: true, force: true });
      }
    });

  await t.test("rejects profile collisions and rolls install and removal failures back without database access",
    () => {
      const temporary = mkdtempSync(join(tmpdir(), "directory-profile-install-"));
      try {
        const starter = join(temporary, "starter");
        copyStarter(starter);
        const databaseFile = join(temporary, "operator-database-must-not-open.db");
        const first = copyProfileAddon(temporary, "profile-first", {
          profile: { id: "shared.ai-tools" },
        });
        const second = copyProfileAddon(temporary, "profile-second", {
          profile: { id: "shared.ai-tools" },
        });
        const firstArchive = join(temporary, "first.zip");
        const secondArchive = join(temporary, "second.zip");
        expectCommandSuccess(runWithoutDatabaseMutation(repository,
          ["pack", first.source, firstArchive], databaseFile), "pack first profile");
        expectCommandSuccess(runWithoutDatabaseMutation(repository,
          ["pack", second.source, secondArchive], databaseFile), "pack colliding profile");
        const baseline = treeSnapshot(starter);
        const failedInstall = runWithoutDatabaseMutation(starter, ["install", firstArchive], databaseFile,
          { NODE_ENV: "test", DIRECTORY_ADDON_TEST_FAIL_AFTER: "2" });
        expectCommandFailure(failedInstall, "injected profile installation failure", /injected/i);
        assert.deepEqual(treeSnapshot(starter), baseline, "failed profile installation changed the workspace");
        expectCommandSuccess(runWithoutDatabaseMutation(starter,
          ["install", firstArchive], databaseFile), "install first profile");
        const installed = treeSnapshot(starter);
        expectCommandFailure(runWithoutDatabaseMutation(starter,
          ["install", secondArchive], databaseFile), "colliding profile ID", /profile.*collision|duplicate.*profile/i);
        assert.deepEqual(treeSnapshot(starter), installed, "profile collision changed the workspace");
        const failedRemove = runWithoutDatabaseMutation(starter, ["remove", "profile-first"], databaseFile,
          { NODE_ENV: "test", DIRECTORY_ADDON_TEST_FAIL_AFTER: "2" });
        expectCommandFailure(failedRemove, "injected profile removal failure", /injected/i);
        assert.deepEqual(treeSnapshot(starter), installed, "failed profile removal changed the workspace");
        expectCommandSuccess(runWithoutDatabaseMutation(starter,
          ["remove", "profile-first"], databaseFile), "remove profile package");
        assert.deepEqual(treeSnapshot(starter), baseline,
          "profile package removal did not restore the clean starter");
      } finally {
        rmSync(temporary, { recursive: true, force: true });
      }
    });

  await t.test("validates a complete typed seed before one idempotent transaction", async (seedTest) => {
    const temporary = mkdtempSync(join(tmpdir(), "directory-profile-seed-"));
    const api = await profileTestContext();
    const seedApi = await import("../src/lib/addon-seed.ts");
    const profile = discoveryProfile();
    const attempt = (seed) => {
      writeInstalledSeed(temporary, profile, seed);
      return () => seedApi.seedInstalledAddon(temporary, "vendor");
    };
    const reset = () => {
      resetProfileTables(api.database);
      activate(api, profile, 0);
    };
    try {
      await seedTest.test("rejects one late invalid typed value without partial rows", async () => {
        reset();
        const seed = seedRecords(profile);
        seed.listings[2].profileValues["vendor.ai-tools.starting-price"].currency = "CAD";
        const before = seedSnapshot(api.database);
        await assert.rejects(attempt(seed), /currency|CAD|profile/i);
        assert.deepEqual(seedSnapshot(api.database), before);
      });
      await seedTest.test("rejects a profile version mismatch without partial rows", async () => {
        reset();
        const seed = seedRecords(profile);
        seed.profile.version = "9.9.9";
        const before = seedSnapshot(api.database);
        await assert.rejects(attempt(seed), /profile|version|active/i);
        assert.deepEqual(seedSnapshot(api.database), before);
      });
      await seedTest.test("rejects duplicate slugs without partial rows", async () => {
        reset();
        const seed = seedRecords(profile);
        seed.listings[2].slug = seed.listings[0].slug;
        const before = seedSnapshot(api.database);
        await assert.rejects(attempt(seed), /duplicate|slug/i);
        assert.deepEqual(seedSnapshot(api.database), before);
      });
      await seedTest.test("rejects duplicate destinations without partial rows", async () => {
        reset();
        const seed = seedRecords(profile);
        seed.listings[2].url = seed.listings[0].url;
        const before = seedSnapshot(api.database);
        await assert.rejects(attempt(seed), /duplicate|destination/i);
        assert.deepEqual(seedSnapshot(api.database), before);
      });
      await seedTest.test("rejects a conflicting existing slug without partial rows", async () => {
        reset();
        insertListing(api.database, "seed-tool-3");
        const before = seedSnapshot(api.database);
        await assert.rejects(attempt(seedRecords(profile)), /slug|exists|conflict/i);
        assert.deepEqual(seedSnapshot(api.database), before);
      });
      await seedTest.test("rejects a conflicting prior seed digest", async () => {
        reset();
        api.database.prepare(`INSERT INTO directory_profile_seed_runs
          (addon_id, addon_version, seed_digest, profile_id, profile_version, record_count, applied_at)
          VALUES ('vendor', '1.0.0', ?, 'vendor.ai-tools', '1.0.0', 1, ?)`)
          .run("d".repeat(64), "2026-10-14T00:00:00.000Z");
        const before = seedSnapshot(api.database);
        await assert.rejects(attempt(seedRecords(profile)), /different|digest|already/i);
        assert.deepEqual(seedSnapshot(api.database), before);
      });
      await seedTest.test("rejects an unowned media reference without partial rows", async () => {
        reset();
        const seed = seedRecords(profile);
        seed.listings[2].profileValues["vendor.ai-tools.screenshot"] =
          "123e4567-e89b-12d3-a456-426614174999";
        const before = seedSnapshot(api.database);
        await assert.rejects(attempt(seed), /media|owned/i);
        assert.deepEqual(seedSnapshot(api.database), before);
      });
      await seedTest.test("applies an equal seed digest once and reports every retry as existing", async () => {
        reset();
        const invoke = attempt(seedRecords(profile));
        assert.deepEqual(await invoke(), { inserted: 3, existing: 0 });
        const afterFirst = seedSnapshot(api.database);
        assert.equal(afterFirst.directory_profile_seed_runs.length, 1);
        assert.deepEqual(await invoke(), { inserted: 0, existing: 3 });
        assert.deepEqual(seedSnapshot(api.database), afterFirst);
      });
      await seedTest.test("rolls the full batch back when a late database write fails", async () => {
        reset();
        api.database.exec(`CREATE TEMP TRIGGER reject_last_profile_seed
          BEFORE INSERT ON listings WHEN NEW.slug = 'seed-tool-3'
          BEGIN SELECT RAISE(ABORT, 'injected late seed failure'); END;`);
        const before = seedSnapshot(api.database);
        try {
          await assert.rejects(attempt(seedRecords(profile)), /injected late seed failure/i);
          assert.deepEqual(seedSnapshot(api.database), before);
        } finally {
          api.database.exec("DROP TRIGGER reject_last_profile_seed");
        }
      });
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });

  await t.test("keeps incomplete agent imports private through direct and browser-approved publication", async () => {
    const api = await profileTestContext();
    resetProfileTables(api.database);
    activate(api, authoringProfile(), 0);
    api.database.prepare("INSERT INTO categories (name) VALUES ('Tools')").run();
    const imports = await import("../src/lib/agent-imports.ts");
    const [staged] = imports.stageAgentImports("profile-catalog", { kind: "key", id: "profile-key" }, [{
      idempotencyKey: "incomplete-profile",
      url: "https://example.com/incomplete-profile",
      sourceUrl: "https://source.example.com/incomplete-profile",
      sourceExcerpt: "Observed directory candidate",
      name: "Incomplete profile",
      summary: "The required typed field is deliberately absent.",
      description: "Incomplete staged records remain available for review without becoming public.",
      category: "Tools",
      profileValues: {},
      profileStateRevision: 1,
    }]);
    assert.equal(staged.status, "created");
    const before = {
      listing: api.database.prepare("SELECT * FROM listings WHERE slug = ?").get(staged.slug),
      imported: api.database.prepare("SELECT * FROM agent_imports WHERE slug = ?").get(staged.slug),
      values: profileSnapshot(api.database),
    };
    assert.throws(() => imports.publishAgentImport("profile-catalog", staged.slug),
      /required|pricing|profile/i);
    assert.equal(api.database.prepare("SELECT status FROM listings WHERE slug = ?")
      .pluck().get(staged.slug), "draft");
    imports.approveAgentImportForBrowser("profile-catalog", staged.slug);
    assert.throws(() => imports.publishBrowserApprovedAgentImport("profile-catalog", staged.slug),
      /required|pricing|profile/i);
    imports.markAgentImportChanged(staged.slug);
    assert.throws(() => imports.publishBrowserApprovedAgentImport("profile-catalog", staged.slug),
      /approval|revision|profile/i);
    const after = {
      listing: api.database.prepare("SELECT * FROM listings WHERE slug = ?").get(staged.slug),
      imported: api.database.prepare("SELECT * FROM agent_imports WHERE slug = ?").get(staged.slug),
      values: profileSnapshot(api.database),
    };
    assert.equal(after.listing.status, before.listing.status);
    assert.equal(after.listing.revision, before.listing.revision);
    assert.equal(after.imported.published_at, null);
    assert.deepEqual(after.values, before.values);
  });

  await t.test("preserves every profile table and rejects corrupted restored profile state",
    async () => {
      const temporary = mkdtempSync(join(tmpdir(), "directory-profile-recovery-"));
      const api = await profileTestContext();
      resetProfileTables(api.database);
      const mediaDirectory = join(temporary, "media");
      mkdirSync(mediaDirectory);
      const mediaId = "123e4567-e89b-12d3-a456-426614174321";
      const key = randomBytes(32).toString("base64url");
      const keyFile = join(temporary, "billing.key");
      writeFileSync(keyFile, `${key}\n`, { mode: 0o600 });
      try {
        activate(api, discoveryProfile(), 0);
        const listingApi = await import("../src/lib/listings.ts");
        listingApi.createListing(parseListing(listingInput("recovery-profile",
          publicProfileValues(0), 1, { status: "published" })), "profile-admin");
        activate(api, { ...discoveryProfile(), version: "1.1.0" }, 1);
        api.saveSiteField({
          field: commonField("site.certification", "Certification", "short-text",
            { minLength: 1, maxLength: 80 }),
          expectedRevision: 2,
          actorUserId: "profile-admin",
        });
        insertProfileMedia(api.database, {
          id: mediaId,
          slug: "recovery-profile",
          fieldKey: "vendor.ai-tools.screenshot",
          uploadedBy: "profile-admin",
          state: "public",
        });
        writeFileSync(join(mediaDirectory, `${mediaId}.webp`), Buffer.from("profile-media"));
        const valuesApi = await import("../src/lib/profile-values.ts");
        valuesApi.replaceListingProfileValues({
          listingSlug: "recovery-profile",
          values: {
            ...publicProfileValues(0),
            "vendor.ai-tools.screenshot": mediaId,
            "site.certification": "Verified",
          },
          profiles: api.activeDirectoryProfiles(),
        });
        api.database.prepare(`INSERT INTO directory_profile_seed_runs
          (addon_id, addon_version, seed_digest, profile_id, profile_version, record_count, applied_at)
          VALUES ('vendor', '1.0.0', ?, 'vendor.ai-tools', '1.1.0', 1, ?)`)
          .run("c".repeat(64), "2026-10-14T00:00:00.000Z");
        api.database.pragma("wal_checkpoint(TRUNCATE)");

        const before = profileTableDump(api.database);
        assert.ok(before.directory_profile_definitions.length >= 3, "fixture needs inactive and site definitions");
        assert.ok(before.directory_profile_values.some(({ archived_at }) => archived_at),
          "fixture needs archived values");
        assert.ok(before.directory_profile_values.some(({ archived_at }) => !archived_at),
          "fixture needs current values");
        const backup = join(temporary, "backup");
        const operationsEnv = {
          DATABASE_URL: process.env.DATABASE_URL,
          MEDIA_DIR: mediaDirectory,
          BILLING_ENCRYPTION_KEY: key,
        };
        expectCommandSuccess(command(repository, process.execPath,
          ["scripts/backup.mjs", "--output", backup, "--key-file", keyFile], operationsEnv),
        "profile backup");
        const restored = join(temporary, "restored");
        expectCommandSuccess(command(repository, process.execPath,
          ["scripts/restore.mjs", "--backup", backup, "--target", restored], operationsEnv),
        "profile restore");
        const restoredDatabase = new Database(join(restored, "database.db"), { readonly: true });
        try {
          assert.deepEqual(profileTableDump(restoredDatabase), before);
        } finally {
          restoredDatabase.close();
        }
        assert.equal(sha256(readFileSync(join(restored, "media", `${mediaId}.webp`))),
          sha256(readFileSync(join(mediaDirectory, `${mediaId}.webp`))));

        const corruptions = [
          ["definition digest", (database) => database.prepare(`UPDATE directory_profile_definitions
            SET digest = ? WHERE profile_id = 'vendor.ai-tools' AND version = '1.1.0'`)
            .run("0".repeat(64))],
          ["active state reference", (database) => database.prepare(`UPDATE directory_profile_state
            SET base_profile_version = '9.9.9' WHERE id = 1`).run()],
          ["typed value columns", (database) => database.prepare(`UPDATE directory_profile_values
            SET text_value = 'impossible' WHERE value_type = 'money' AND archived_at IS NULL`).run()],
          ["archived definition reference", (database) => database.prepare(`UPDATE directory_profile_values
            SET definition_version = '9.9.9' WHERE archived_at IS NOT NULL`).run()],
          ["migration mapping", (database) => database.prepare(`UPDATE directory_profile_changes
            SET plan_json = '{"fields":{"missing.field":{"action":"archive"}},"defaults":{}}'
            WHERE kind = 'activate' AND from_version IS NOT NULL`).run()],
          ["profile media file", null],
        ];
        for (const [name, corrupt] of corruptions) {
          const damaged = join(temporary, `damaged-${name.replaceAll(" ", "-")}`);
          cpSync(backup, damaged, { recursive: true });
          if (corrupt) {
            const database = new Database(join(damaged, "database.db"));
            try { corrupt(database); } finally { database.close(); }
          } else {
            rmSync(join(damaged, "media", `${mediaId}.webp`));
          }
          refreshBackupManifest(damaged);
          const target = join(temporary, `rejected-${name.replaceAll(" ", "-")}`);
          expectCommandFailure(command(repository, process.execPath,
            ["scripts/restore.mjs", "--backup", damaged, "--target", target], operationsEnv),
          `corrupt ${name}`, /profile|definition|value|media|migration|integrity|reference/i);
          assert.equal(existsSync(target), false, `corrupt ${name} produced a restore target`);
        }
      } finally {
        rmSync(temporary, { recursive: true, force: true });
      }
    });
});
