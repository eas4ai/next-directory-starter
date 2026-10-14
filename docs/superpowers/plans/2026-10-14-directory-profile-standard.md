# Directory Profile Standard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the complete production directory-profile standard: immutable schemas, typed listing values, protected authoring and moderation, server-rendered facets and generic presentation, profile-bearing add-ons and seeds, and verified operational preservation.

**Architecture:** Profile JSON is validated by one runtime schema shared by the add-on CLI and application. Activation copies an immutable definition into SQLite; typed listing values live in normalized indexed rows, while owner proposals carry a validated snapshot until moderation publishes core and profile data in one transaction. Public query parsing builds bounded allowlisted SQL from the active stored definition, and reusable form and renderer components consume presentation descriptors derived from that same definition.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 6, SQLite through better-sqlite3, Zod 4, Node test runner, Playwright Chromium, existing add-on ZIP tooling.

**Spec:** `docs/superpowers/specs/2026-10-14-directory-profiles-design.md` and `docs/spec/profiles.md`

## Global Constraints

- This is a production feature. Ship every supported field family and lifecycle operation with validation, authorization, persistence, recovery, accessible interfaces, documentation, and verification.
- Preserve the separation between directory profiles, public templates, and themes.
- Keep core listing identity shared when profiles switch; retain inactive profile values and archived field values.
- Store active definitions as immutable database snapshots so removing an add-on cannot strand operator data.
- Support short text, Markdown text, boolean, integer, decimal, money with currency, single choice, multiple choice, URL, date, date/time, date range, duration, structured location, media references, and bounded repeatable structured groups.
- Cap a definition at 100 top-level fields, 50 choices per choice field, 20 children per repeatable group, 25 instances per repeatable group, 256 KiB per profile JSON file, 256 KiB per interactive profile-value body, 100,000 value rows per online migration, 12 public facets, 20 selected values per facet, 120 bytes per facet value, and 4,096 bytes of accepted public query state.
- Use semantic versions for packaged profiles. Use `site.local` and monotonically generated `0.0.<state revision>` versions for the site-owned field layer.
- Profile IDs use `<owner>.<profile>` lowercase namespaces; packaged field keys use `<profile-id>.<field>`, and site fields use `site.<field>`.
- An add-on install, validate, pack, or remove operation must not open the operator database.
- Server authorization and validation are authoritative. Client components supply usability and immediate feedback only.
- Public outputs may read only active fields whose visibility is `public`, only current values for published eligible listings, and only public media owned by those listings.
- Preserve no-JavaScript discovery, keyboard operation, light and dark appearances, and layouts without horizontal scrolling at 320 pixels.
- Follow test-driven development for every production change: add the focused failing case, run it and inspect the expected failure, add the smallest complete implementation, run the focused case and the project suite, then commit.
- Follow the current `sudus wake` action. Lease declared inputs before editing, commit before `sudus end --lease <sha>`, and run the named requirement after the lease closes.

## Review Focus

- A same-version profile file with different bytes must be rejected without changing the stored definition, active state, or listing values; Task 3 adds an immutability and rollback test.
- A profile switch racing a listing edit must reject one stale operation and preserve one internally consistent revision; Tasks 3 and 7 add state-revision and listing-revision race tests.
- Private, staff-only, archived, draft, rejected, suspended, and banned-owner values must not influence public rows, facet counts, Markdown, metadata, JSON-LD, or media; Tasks 10 and 11 add sentinel leak tests across each output.
- Decimal, money, date/time, date ranges, durations, and coordinates must compare by normalized value rather than display text; Tasks 6 and 10 add boundary and ordering tests.
- A profile-bearing seed, failed add-on install, backup, isolated restore, or failed upgrade must leave a complete recoverable state; Tasks 13 and 14 add transaction snapshots and restored-database invariant checks.

---

## File structure

### Shared schema and lifecycle

- `scripts/addons/profile-schema.mjs`: the single Zod runtime schema, profile bounds, canonicalization, digest input, and safe URL/Markdown constraint validation used by both CLI and app.
- `src/lib/directory-profile-types.ts`: TypeScript definitions for the runtime schema, normalized values, impact reports, migration plans, active state, and public descriptors.
- `src/lib/directory-profiles.ts`: installed-source reads, immutable definition persistence, impact analysis, activation, switching, site-layer versioning, archival, purge, and lifecycle audit calls.
- `src/lib/catalog-migrations.ts`: migration 33 with profile definitions, active state, typed values, indexes, profile media, changes, and seed-run tables.

### Values, authoring, and moderation

- `src/lib/profile-values.ts`: type-specific input parsing, normalized encoding/decoding, full-record validation, transactional replace/archive operations, batched reads, media ownership, and publishability checks.
- `src/lib/catalog-input.ts` and `src/lib/listings.ts`: carry `profileValues` and `profileStateRevision` through core listing writes and enforce the listing revision as the joint concurrency boundary.
- `src/lib/moderation.ts` and `src/lib/agent-imports.ts`: snapshot profile values in proposals/imports and publish them atomically only when the active definition still validates.
- `src/lib/media.ts` and `src/lib/media-routes.ts`: create private profile media assets and expose them only to the owner or authorized staff until a matching value is published.
- `src/components/profile-field-editor.tsx`: accessible controls for every field type and repeatable group.
- `src/components/profile-values-view.tsx`: generic badges, card facts, grouped detail values, safe links, Markdown, dates, money, locations, and media.
- `src/app/admin/profiles/page.tsx`, `src/app/admin/profiles/profile-manager.tsx`, `src/app/api/admin/profiles/route.ts`, `src/app/api/admin/profiles/impact/route.ts`, `src/app/api/admin/profiles/activate/route.ts`, `src/app/api/admin/profiles/site-fields/route.ts`, and `src/app/api/admin/profiles/purge/route.ts`: protected lifecycle workspace and APIs.
- Existing catalog, owner, and review pages/components and routes: embed generated profile fields and display one complete proposed revision.

### Public discovery

- `src/lib/profile-discovery.ts`: bounded GET parsing, allowlisted facet/sort planning, indexed SQL, counts, stable pagination, and URL serialization.
- `src/components/profile-facets.tsx`: server-rendered GET controls for active public facets and sorts.
- `src/app/listings/page.tsx` and `src/app/listings/[slug]/page.tsx`: generic card/detail rendering and canonical/noindex behavior.
- `src/app/markdown/listings/[slug]/route.ts`, `src/lib/markdown-twins.ts`, and structured metadata call sites: public-only projection shared across alternate outputs.

### Add-ons and operations

- `scripts/addons/manifest.mjs`, `archive.mjs`, `workspace.mjs`, and `registry.mjs`: profile declarations, payload validation, integrity, ownership, deterministic packing, install/remove safety, and installed-source registry.
- `src/lib/addon-seed.ts` and `src/lib/catalog-migrations.ts`: full-batch typed profile seed validation and one idempotent transaction.
- `fixtures/addons/reference-addon/directory-addon.json`, `fixtures/addons/reference-addon/src/ai-tools.profile.json`, and `fixtures/addons/reference-addon/seed/catalog.json`: one real profile declaration, profile JSON, and versioned typed seed.
- `scripts/ops-common.mjs` and `docs/operator-manual.md`: profile integrity inspection and activation/migration/backup/restore/upgrade procedures.
- `tests/directory-profiles.test.mjs` and `mechanisms/check-directory-profiles.mjs`: one independently selectable top-level test per PRF requirement, with subtests that reach the named behavior.

---

### Task 1: Lock complete PRF-001 red coverage

**Files:**
- Modify: `tests/directory-profiles.test.mjs`
- Modify: `mechanisms/check-directory-profiles.mjs`
- Modify: `mechanisms/directory-profiles.def.json`
- Modify after declaration: `.sudus/mechanisms/directory-profiles.json`

**Interfaces:**
- Consumes: the `PROFILE_REQUIREMENT` selector and TAP helpers already used by the mechanism.
- Produces: a reviewed PRF-001 failure receipt that reaches schema validation and lifecycle behavior without depending on PRF-002, PRF-003, or PRF-004.

- [ ] **Step 1: Replace the PRF-001 smoke assertion with behavior-first subtests**

Use a temporary SQLite database and fixture builders in `tests/directory-profiles.test.mjs`. The PRF-001 top-level test must cover:

```js
await t.test('rejects every invalid field family and bound', () => {
  assert.throws(() => parseDirectoryProfileDefinition(duplicateKeys), /duplicate field/i);
  assert.throws(() => parseDirectoryProfileDefinition(unboundedGroup), /25|bounded/i);
  assert.throws(() => parseDirectoryProfileDefinition(unsafeDefaultUrl), /URL/i);
  assert.throws(() => parseDirectoryProfileDefinition(contradictoryPrivateFacet), /visibility/i);
});
await t.test('stores one immutable canonical definition', () => {
  const first = activateDirectoryProfile({ definition, actorUserId: 'admin', expectedRevision: 0 });
  assert.equal(first.digest, expectedDigest);
  assert.throws(() => activateDirectoryProfile({
    definition: { ...definition, name: 'Changed bytes at the same version' },
    actorUserId: 'admin', expectedRevision: 1,
  }), /immutable|version/i);
});
await t.test('reports and applies compatible, breaking, site, and switch changes atomically', () => {
  assert.deepEqual(impact.breakingFields, ['vendor.ai-tools.price']);
  assert.throws(() => activateDirectoryProfile({
    definition: breaking, actorUserId: 'admin', expectedRevision: 1,
  }), /mapping/i);
  assert.deepEqual(snapshotProfileTables(database), beforeRejectedActivation);
});
```

Include all 16 field types, defaults, cardinality, permission/visibility/placement rules, safe widening, required-field effects on published listings, rename/type mappings, explicit archive, state revision races, the 100,000-row migration limit, inactive profile retention, site namespace enforcement, purge count confirmation, and audit event assertions.

- [ ] **Step 2: Run the focused test and verify the failure reaches PRF-001**

Run: `PROFILE_REQUIREMENT=PRF-001 node --import tsx --test --test-reporter=tap tests/directory-profiles.test.mjs`

Expected: FAIL because the runtime parser and lifecycle APIs are absent; database/test bootstrap succeeds and no PRF-002/003/004 assertion runs.

- [ ] **Step 3: Commit and rebind the detector**

Run the repository-required lease/commit cycle, redeclare `directory-profiles`, run `sudus check PRF-001`, inspect the saved output, and run `sudus review mechanism PRF-001 <fail-receipt>`.

Commit message: `test: define directory profile lifecycle behavior`

---

### Task 2: Add the runtime profile schema and normalized database

**Files:**
- Create: `scripts/addons/profile-schema.mjs`
- Create: `src/lib/directory-profile-types.ts`
- Create: `src/lib/profile-values.ts`
- Modify: `src/lib/catalog-migrations.ts`
- Test: `tests/directory-profiles.test.mjs`

**Interfaces:**
- Consumes: Zod, semantic versions from `semver`, `applyCatalogMigration(version, change)`, and the exact limits in Global Constraints.
- Produces: `parseDirectoryProfileDefinition(input): DirectoryProfileDefinition`, `canonicalProfileJson(definition): string`, `profileDigest(definition): string`, `validateProfileFieldValue(field, input, context): CanonicalProfileValue`, `encodeProfileValue(field, value): NormalizedProfileRow[]`, `decodeProfileValue(field, rows): CanonicalProfileValue`, `reindexProfileSearch(listingSlug, profiles): void`, `migrateCatalog()` migration 33, and normalized profile tables.

- [ ] **Step 1: Select the existing red parser and codec cases one field family at a time**

Task 1 already created and ran each case before production code. Run each named subtest again before its implementation group. The cases include one valid definition, one invalid boundary, canonical defaults, exact normalized encodings, and error paths. One representative case is:

```js
await t.test('money requires bounded minor units and an allowlisted currency', () => {
  const parsed = parseDirectoryProfileDefinition(profileWith(moneyField));
  assert.deepEqual(parsed.fields[0].constraints.currencies, ['EUR', 'USD']);
  assert.throws(() => parseDirectoryProfileDefinition(profileWith({
    ...moneyField, default: { amountMinor: 100, currency: 'usd<script>' },
  })), /currency/i);
});
```

- [ ] **Step 2: Run PRF-001 and confirm the selected case still fails for the expected missing rule**

Run the focused PRF-001 command after each field-family group.

- [ ] **Step 3: Implement the discriminated runtime schema**

Export these constants and functions from `scripts/addons/profile-schema.mjs`:

```js
export const PROFILE_SCHEMA_VERSION = 1;
export const PROFILE_LIMITS = Object.freeze({
  fields: 100, choices: 50, groupChildren: 20, groupItems: 25,
  fileBytes: 256 * 1024, valueBodyBytes: 256 * 1024,
  migrationRows: 100_000, facets: 12, facetValues: 20,
  facetValueBytes: 120, queryBytes: 4096,
});
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
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
  return createHash('sha256').update(canonicalProfileJson(input)).digest('hex');
}
```

Use explicit schemas for every type. Repeatable-group children may use every scalar/media type but cannot nest another group. Reject public facets/sorts/search on non-public fields, facets on Markdown/URL/media/group fields, multiple cardinality on scalar range sorts, defaults outside constraints, duplicate choice values, duplicate sort keys, and keys outside their profile namespace.

- [ ] **Step 4: Add and verify migration 33**

Create these tables in one `applyCatalogMigration(33, ...)` call:

```sql
CREATE TABLE directory_profile_definitions (
  profile_id TEXT NOT NULL,
  version TEXT NOT NULL,
  name TEXT NOT NULL,
  digest TEXT NOT NULL,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('addon','site')),
  source_id TEXT,
  definition_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  PRIMARY KEY (profile_id, version),
  UNIQUE (profile_id, version, digest)
);
CREATE TABLE directory_profile_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  base_profile_id TEXT,
  base_profile_version TEXT,
  site_profile_id TEXT,
  site_profile_version TEXT,
  revision INTEGER NOT NULL CHECK (revision >= 0),
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);
CREATE TABLE directory_profile_values (
  listing_slug TEXT NOT NULL REFERENCES listings(slug) ON DELETE CASCADE,
  profile_id TEXT NOT NULL,
  definition_version TEXT NOT NULL,
  field_key TEXT NOT NULL,
  item_id TEXT NOT NULL,
  child_key TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL CHECK (position BETWEEN 0 AND 24),
  value_type TEXT NOT NULL,
  text_value TEXT,
  integer_value INTEGER,
  real_value REAL,
  currency TEXT,
  date_start TEXT,
  date_end TEXT,
  country_code TEXT,
  region TEXT,
  locality TEXT,
  latitude_e6 INTEGER,
  longitude_e6 INTEGER,
  media_id TEXT REFERENCES media_assets(id) ON DELETE RESTRICT,
  archived_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (listing_slug, profile_id, field_key, item_id, child_key)
);
```

Also create `directory_profile_changes`, `directory_profile_media`, `directory_profile_seed_runs`, typed partial indexes for text, integer, real, dates, location, currency/amount, active rows by listing, and an FTS5 `directory_profile_search` table. Insert singleton state revision 0. The existing red cases assert migration idempotence and `foreign_key_check`.

- [ ] **Step 5: Implement and verify the pure typed-value codecs**

Encode decimal values as scaled integers using the field's declared scale, money as minor units plus an uppercase allowlisted currency, booleans as 0/1, date/time as canonical ISO text, durations as integer seconds, and coordinates as integer millionths. Choice sets follow declared option order. Repeatable group rows share the stable item ID, retain explicit position, and use each child field key. Each decode must round-trip to the canonical JSON shape consumed by forms, proposals, seeds, and mappings. `reindexProfileSearch` deletes and rebuilds only one listing's active public searchable terms and is safe inside an existing transaction.

- [ ] **Step 6: Run focused and regression tests**

Run: `PROFILE_REQUIREMENT=PRF-001 node --import tsx --test tests/directory-profiles.test.mjs`

Run: `npm test`

Expected: parser and migration subtests pass; lifecycle subtests remain red until Task 3; existing tests stay green.

- [ ] **Step 7: Commit**

Commit message: `feat: add directory profile schema storage`

---

### Task 3: Implement immutable lifecycle, impact, mappings, site fields, and purge

**Files:**
- Create: `src/lib/directory-profiles.ts`
- Create: `src/app/admin/profiles/page.tsx`
- Create: `src/app/admin/profiles/profile-manager.tsx`
- Create: `src/app/api/admin/profiles/route.ts`
- Create: `src/app/api/admin/profiles/impact/route.ts`
- Create: `src/app/api/admin/profiles/activate/route.ts`
- Create: `src/app/api/admin/profiles/site-fields/route.ts`
- Create: `src/app/api/admin/profiles/purge/route.ts`
- Modify: `src/lib/overview.ts`
- Modify: `src/app/admin/catalog/page.tsx`
- Modify: `src/app/admin/overview/page.tsx`
- Test: `tests/directory-profiles.test.mjs`

**Interfaces:**
- Consumes: validated canonical definitions, pure typed-value encode/decode/reindex functions, normalized profile tables, `requireCurrentActor`, `canAdmin`, and `recordAudit`.
- Produces:

```ts
export { parseDirectoryProfileDefinition } from '../../scripts/addons/profile-schema.mjs';
export function directoryProfileState(): DirectoryProfileState;
export function availableDirectoryProfiles(): StoredProfileSummary[];
export function activeDirectoryProfiles(): ActiveProfileSet;
export function profileImpact(input: {
  definition: unknown; expectedRevision: number; migration?: ProfileMigrationPlan;
}): ProfileImpact;
export function activateDirectoryProfile(input: {
  definition: unknown; sourceKind: 'addon' | 'site'; sourceId?: string;
  expectedRevision: number; migration?: ProfileMigrationPlan; actorUserId: string;
}): DirectoryProfileState;
export function saveSiteField(input: {
  field: unknown; expectedRevision: number; actorUserId: string;
}): DirectoryProfileState;
export function archiveSiteField(input: {
  fieldKey: string; expectedRevision: number; actorUserId: string;
}): DirectoryProfileState;
export function purgeArchivedProfileValues(input: {
  profileId: string; fieldKey: string; expectedCount: number;
  expectedRevision: number; actorUserId: string;
}): number;
```

- [ ] **Step 1: Write lifecycle failures for immutability, stale revisions, authorization, and rollback**

Name the production change each test protects. Snapshot every profile table before rejected activation and assert byte-for-byte row equality afterward. Add a user table with admin, catalog, moderator, owner, banned, and unverified actors; only the current verified admin may run lifecycle calls.

- [ ] **Step 2: Run the focused lifecycle test and inspect the failure**

Expected: schema/storage succeeds and the first missing lifecycle function or transaction behavior fails.

- [ ] **Step 3: Implement impact analysis without writes**

Classify changes as compatible only for optional additions, display-only metadata changes, wider numeric/date/text bounds, and additive choices. Require an explicit migration entry for removal, rename, cardinality change, type change, choice removal, visibility/write-authority narrowing, or a newly required field. Return affected listing/value counts, invalid-value samples capped at 20, published missing-required counts, and the current state revision. Refuse work above 100,000 value rows.

- [ ] **Step 4: Implement transactional activation and mapping**

In one immediate transaction: re-read state revision; enforce actor status; reject same-version/different-digest bytes; insert the immutable definition; validate every mapping target and transformed value; copy valid mapped rows; archive explicitly archived or invalid rows; materialize defaults for required published rows; rebuild affected searchable rows; update the active base or site layer; append `directory_profile_changes`; and call `recordAudit`. Any throw rolls back every step.

Decode an old typed value and re-run the target field codec for type changes. Support choice `valueMap` and `onInvalid: 'reject' | 'archive'`. Never infer a rename or conversion from labels.

- [ ] **Step 5: Implement the protected profile workspace**

The server page requires `canAdmin`, is `noindex`, and passes only installed/stored profile summaries and impact counts. The client renders named controls for source/version selection, field creation, type constraints, permissions, visibility, placement, discovery settings, mapping action, and typed defaults. It displays the impact report before activation and sends `expectedRevision` on every mutation. Purge requires the typed archived count returned by the impact endpoint.

- [ ] **Step 6: Add the Profiles destination**

Add `{ href: '/admin/profiles', label: 'Directory profiles' }` only inside the `canAdmin(role)` block in `overviewDestinations`. Add a link from catalog copy so a catalog editor understands that administrators own the schema.

- [ ] **Step 7: Run PRF-001 and the full suite**

Run: `PROFILE_REQUIREMENT=PRF-001 node --import tsx --test tests/directory-profiles.test.mjs`

Run: `npm test`

Expected: all PRF-001 subtests and existing tests pass.

- [ ] **Step 8: Commit, close the lease, and record the Sudus pass**

Commit message: `feat: add directory profile lifecycle`

Run `sudus check PRF-001`. If the detector digest changed after its reviewed red receipt, follow the exact wake action until PRF-001 has a current passing receipt and matching review metadata.

---

### Task 4: Lock complete PRF-002 red coverage

**Files:**
- Modify: `tests/directory-profiles.test.mjs`
- Modify after declaration: `.sudus/mechanisms/directory-profiles.json`

**Interfaces:**
- Consumes: active definitions created through the PRF-001 public API.
- Produces: an independently reviewed PRF-002 red receipt for typed values, forms, authority, revisions, moderation, media safety, archive retention, and audit behavior.

- [ ] **Step 1: Replace the PRF-002 smoke test with behavior cases**

Cover all field types through real `parseListing`, admin create/update, owner draft/submit, moderation approval/rejection, and media paths. Assert:

```js
assert.throws(() => validateProfileValues(definitions, hostile, 'owner'), /Markdown|URL|media/i);
assert.throws(() => updateOwnerListing(ownerId, slug, operatorOnlyChange), /permission/i);
assert.throws(() => updateListing(staleCombinedRevision, adminId, 1), /changed since/i);
assert.deepEqual(publishedProfileValues(slug), approvedSnapshot);
assert.deepEqual(archivedProfileValues(slug, removedField), priorValue);
```

Use sentinels for unowned media, private Markdown, stale profile-state revisions, core/profile partial writes, suspended owners, unverified staff, rejected submissions, and lifecycle audit entries.

- [ ] **Step 2: Run PRF-002 and verify a requirement-specific failure**

Run: `PROFILE_REQUIREMENT=PRF-002 node --import tsx --test --test-reporter=tap tests/directory-profiles.test.mjs`

Expected: FAIL after the profile schema and database initialize, at the first missing typed-value or joint-revision behavior.

- [ ] **Step 3: Commit and review the new detector digest**

Commit message: `test: define profile authoring and moderation behavior`

Redeclare the mechanism if its definition changed, run `sudus check PRF-002`, inspect its output, and review that fail receipt.

---

### Task 5: Implement typed codecs and normalized value persistence

**Files:**
- Modify: `src/lib/profile-values.ts`
- Modify: `src/lib/directory-profile-types.ts`
- Modify: `src/lib/catalog-input.ts`
- Modify: `src/lib/listings.ts`
- Test: `tests/directory-profiles.test.mjs`

**Interfaces:**
- Consumes: `ActiveProfileSet`, the pure field codecs from Task 2, the profile state revision, existing listing revision, and media ownership lookups.
- Produces:

```ts
export type ProfileValueSet = Record<string, unknown>;
export function validateProfileValues(input: unknown, options: {
  profiles: ActiveProfileSet; authority: 'operator' | 'owner' | 'system';
  listingSlug?: string; actorUserId?: string; requireComplete: boolean;
}): ValidatedProfileValues;
export function replaceListingProfileValues(input: {
  listingSlug: string; values: ValidatedProfileValues; profiles: ActiveProfileSet;
}): void;
export function profileValuesForListings(slugs: readonly string[], options?: {
  includePrivate?: boolean; includeArchived?: boolean;
}): Map<string, ProfileValueSet>;
export function assertListingProfilePublishable(slug: string): void;
```

- [ ] **Step 1: Select the existing red complete-record and persistence cases**

Task 4 already ran the complete-record cases red. Select the assertions for authority, required fields, cardinality, media ownership, unknown keys, archived fields, transaction rollback, and batched hydration. The pure encoding boundaries already pass from Task 2.

- [ ] **Step 2: Run the focused test and confirm the codec boundary fails**

Expected: FAIL on the named type or persistence rule.

- [ ] **Step 3: Implement validation and encoding**

Return field-level errors with stable field keys. Treat `undefined` as absent and preserve `false`, `0`, and empty allowed collections. Canonicalize sets by declared choice order; retain repeatable item IDs and user order. Validate media rows belong to the listing and are owned by the actor or were uploaded by authorized staff. Rebuild FTS rows from only active public searchable values inside the same transaction as normalized rows.

- [ ] **Step 4: Join profile values to listing input and writes**

Make `Listing.profileValues` a required property with `{}` as the parsed default and add `profileStateRevision`. Admin create/update validates a complete operator-authority record. `createListing` and `updateListing` replace core and normalized values in the same immediate transaction. Every read returning multiple listings performs one batched value query; detail reads may perform one value query.

- [ ] **Step 5: Test rollback and query count**

Inject an invalid final field after valid earlier fields and assert no core or value row changes. Count `database.prepare` calls for `allListings(100 rows)` and assert profile hydration performs a bounded fixed number rather than one query per listing.

- [ ] **Step 6: Run focused and full tests, then commit**

Run PRF-002, then `npm test`.

Commit message: `feat: store typed profile listing values`

---

### Task 6: Generate accessible authoring controls and safe profile media

**Files:**
- Create: `src/components/profile-field-editor.tsx`
- Create: `src/app/api/profile-media/[slug]/route.ts`
- Modify: `src/components/image-uploader.tsx`
- Modify: `src/lib/media.ts`
- Modify: `src/lib/media-routes.ts`
- Modify: `src/app/admin/catalog/catalog-editor.tsx`
- Modify: `src/app/admin/catalog/page.tsx`
- Modify: `src/app/api/admin/listings/route.ts`
- Modify: `src/app/api/admin/listings/[slug]/route.ts`
- Modify: `src/app/owner/listings/owner-editor.tsx`
- Modify: `src/app/owner/listings/page.tsx`
- Modify: `src/app/api/owner/listings/route.ts`
- Modify: `src/app/api/owner/listings/[slug]/route.ts`
- Test: `tests/directory-profiles.test.mjs`

**Interfaces:**
- Consumes: active form descriptors, validated `ProfileValueSet`, current actor role/ownership, and existing 5 MiB raster upload safeguards.
- Produces: `ProfileFieldEditor({ fields, values, authority, mediaEndpoint, errors, onChange })` and profile-media GET/POST responses containing `{ asset }`.

- [ ] **Step 1: Select the existing red server-render and component cases for every control**

Assert label/help/error associations and input types: text, textarea, checkbox, integer/decimal number, amount plus currency, radio/select, checkbox group, URL, date, datetime-local, two date controls, duration amount/unit, location fieldset, media uploader, and repeatable group add/remove/reorder buttons. Owner rendering must omit operator/system fields rather than disabling and disclosing them.

- [ ] **Step 2: Run PRF-002 and verify the missing-control failure**

- [ ] **Step 3: Implement descriptor-driven controls**

Use stable React keys from field keys and repeatable item IDs. Every help text gets an ID used by `aria-describedby`; every group uses `fieldset`/`legend`; add/remove/reorder controls have field and item names in their accessible labels. Render constraints as native attributes where representable and retain server errors beside the field.

- [ ] **Step 4: Add private profile media uploads**

The route accepts `fieldKey` and `itemId`, bounds their lengths, checks the active definition is a writable media field, then calls `uploadProfileMedia`. Store the asset in `media_assets` plus `directory_profile_media` with state `draft`. Extend private media authorization to listing owners and staff who can edit/review the referenced listing. Promotion marks only IDs contained in the approved profile snapshot as `public`; displaced or abandoned assets enter the existing cleanup queue. Public reads additionally require a current public profile-value row referencing that asset.

- [ ] **Step 5: Embed the editor in admin and owner flows**

Server pages load active descriptors and values. Client submit bodies include `profileValues` and `profileStateRevision`; request limits become 256 KiB. Catalog forms show operator and owner fields; owner forms show owner fields. Display structured field errors returned by the API and refresh state/revision after success.

- [ ] **Step 6: Run keyboard, authority, media, and full tests, then commit**

Run PRF-002, `npm test`, and ESLint on changed components.

Commit message: `feat: add generated profile authoring forms`

---

### Task 7: Make proposals, moderation, and agent publication atomic

**Files:**
- Modify: `src/lib/moderation.ts`
- Modify: `src/lib/agent-imports.ts`
- Modify: `src/app/admin/review/page.tsx`
- Modify: `src/app/admin/import/import-workspace.tsx`
- Modify: `src/app/api/admin/submissions/[id]/decision/route.ts`
- Test: `tests/directory-profiles.test.mjs`

**Interfaces:**
- Consumes: complete `Listing` input with profile values, active immutable definitions, `replaceListingProfileValues`, and the existing listing revision.
- Produces: proposals and submissions containing `profileValues` plus `profileStateRevision`; publication functions that refuse missing required fields or stale profile state.

- [ ] **Step 1: Select the existing red joint-revision and authorization cases**

Save an owner proposal, change core and profile data after submission, and assert approval returns 409 with no partial update. Reject operator-only owner changes. Assert rejection preserves the private draft, approval publishes the exact submitted snapshot, and concurrent profile activation invalidates approval until resubmission.

- [ ] **Step 2: Run PRF-002 and inspect the expected moderation failure**

- [ ] **Step 3: Persist and review the complete snapshot**

`owner_drafts.payload` and `submissions.payload` contain the validated full listing including profile values and profile state revision. `reviewSubmission` parses through the same server validator instead of casting JSON. The review page uses `ProfileValuesView` in staff mode so private values are visible only after `canModerate` passes.

- [ ] **Step 4: Publish core, profile values, media, SEO, and submission status in one transaction**

On approval, re-check listing revision, profile state revision, ownership, actor status, current schema, required fields, URLs, Markdown, and media. Update core, replace normalized profile rows, promote only referenced media, publish SEO, clear the draft, close the submission, notify the owner, and record audit before commit.

- [ ] **Step 5: Gate agent publication**

Agent staging stores `{}` or partial validated values and remains draft. Both direct and browser-approved publication call `assertListingProfilePublishable`; a missing required field returns a bounded error and leaves listing/import/audit state unchanged. Editing the import revision clears browser approval as it does for core edits.

- [ ] **Step 6: Run PRF-002 and regression tests, then commit and record the requirement pass**

Run PRF-002 and `npm test`.

Commit message: `feat: publish profile values through moderation`

Close the lease, run `sudus check PRF-002`, and follow wake until its current reviewed detector passes.

---

### Task 8: Lock complete PRF-003 red coverage

**Files:**
- Modify: `tests/directory-profiles.test.mjs`
- Modify after declaration: `.sudus/mechanisms/directory-profiles.json`

**Interfaces:**
- Consumes: published normalized values and active stored definitions.
- Produces: an independently reviewed PRF-003 red receipt for query semantics, privacy, SEO, rendering, batching, no-JavaScript operation, keyboard use, and 320-pixel layouts.

- [ ] **Step 1: Add public discovery database cases**

Create listings spanning choice any/all, boolean, numeric/decimal/money boundaries, dates/date ranges, duration, location, searchable text, stable ties, private values, drafts, suspended records, rejected submissions, and banned owners. Assert exact slug order, counts, and pagination links.

- [ ] **Step 2: Add output leak sentinels and browser cases**

Use unique private sentinels and assert absence from list HTML, detail HTML, facet labels/counts, Markdown, metadata, JSON-LD, social card inputs, and feeds. Start the production server, disable JavaScript for one context, submit facets, traverse pagination, keyboard-focus every control, and measure light/dark 320-pixel pages.

- [ ] **Step 3: Run PRF-003 and verify a discovery-specific red failure**

Expected: schema/value setup succeeds and the first missing query parser or public renderer assertion fails.

- [ ] **Step 4: Commit and review the new detector digest**

Commit message: `test: define profile discovery and rendering behavior`

Run and review the PRF-003 fail receipt before production implementation.

---

### Task 9: Implement bounded indexed profile discovery

**Files:**
- Create: `src/lib/profile-discovery.ts`
- Modify: `src/lib/listings.ts`
- Test: `tests/directory-profiles.test.mjs`

**Interfaces:**
- Consumes: active public descriptors, typed indexes, `PUBLIC_LISTING_PREDICATE`, and `LISTINGS_PER_PAGE`.
- Produces:

```ts
export function parseProfileDirectoryQuery(
  input: Record<string, string | string[] | undefined>,
  profiles?: ActiveProfileSet,
): ParsedProfileDirectoryQuery;
export function serializeProfileDirectoryQuery(
  query: ParsedProfileDirectoryQuery, page?: number,
): URLSearchParams;
export function searchProfileDirectory(
  query: ParsedProfileDirectoryQuery,
): ProfileDirectoryResult;
```

- [ ] **Step 1: Select the existing red parser boundary cases**

Reject more than 4,096 accepted bytes, 12 facets, 20 values in one facet, duplicate scalar ranges, unknown sort keys, malformed dates/money/coordinates, and any non-public or non-faceted field without including its label/value in the error. Preserve valid repeated query values and canonical declared order.

- [ ] **Step 2: Run PRF-003 and inspect the parser failure**

- [ ] **Step 3: Implement allowlisted query parsing**

Use `facet.<full-field-key>`, `min.<full-field-key>`, `max.<full-field-key>`, `q`, `sort`, and `page`. Resolve keys only against active public descriptors. Return a generic `invalid: true` state for unknown/hidden/excessive input. Serialization emits only canonical validated state and always appends the requested page last.

- [ ] **Step 4: Build parameterized indexed SQL**

Use one `EXISTS` clause per facet and AND the clauses. For `any`, match `IN (...)`; for `all`, use a grouped subquery whose distinct matched count equals the selected count. Use the correct typed column for ranges and currency-qualified money. Date-range matching uses declared overlap semantics. Location matches normalized country, region, and locality components. Sort joins one active value row, declares null placement, and always ends with `l.slug` as a stable tie breaker.

Use one count query, one page query, one batched value query, and bounded facet-count queries by declared facet count. Text search joins FTS rows plus core fields and never indexes private/staff values.

- [ ] **Step 5: Run semantic, query-plan, and full tests**

Assert `EXPLAIN QUERY PLAN` mentions the expected typed indexes/FTS table for every facet family. Run PRF-003 and `npm test`.

- [ ] **Step 6: Commit**

Commit message: `feat: add indexed profile discovery queries`

---

### Task 10: Render generic facets, cards, details, and safe alternate outputs

**Files:**
- Create: `src/components/profile-facets.tsx`
- Create: `src/components/profile-values-view.tsx`
- Modify: `src/app/listings/page.tsx`
- Modify: `src/app/listings/[slug]/page.tsx`
- Modify: `src/app/markdown/listings/[slug]/route.ts`
- Modify: `src/lib/markdown-twins.ts`
- Modify: `src/components/markdown-content.tsx`
- Modify: `src/app/globals.css`
- Test: `tests/directory-profiles.test.mjs`

**Interfaces:**
- Consumes: `ParsedProfileDirectoryQuery`, facet descriptors/counts, public profile-value projections, and safe public media.
- Produces: a GET-only discovery form, stable page URLs, generic profile card/detail output, and public-only Markdown/metadata projections.

- [ ] **Step 1: Select the existing red renderer cases for every placement and type**

Render badge, card, grouped detail, and hidden placements. Assert locale-independent machine values in `dateTime`/data attributes and readable labels for money, duration, ranges, location, choices, links, media alt text, and repeatable group entries. Dangerous Markdown HTML and URI schemes must not produce active elements.

- [ ] **Step 2: Run PRF-003 and verify the generic renderer failure**

- [ ] **Step 3: Add server-rendered facet and sort controls**

Render a standard GET form with text search, fieldsets, range pairs, location selects/inputs, sort select, Apply, and a link that clears all filters. Selected values and stable sort persist through links produced by `serializeProfileDirectoryQuery`. Invalid query state shows one generic message and no private hint.

- [ ] **Step 4: Use public projections in cards and detail pages**

Hydrate result rows in one batch. Cards render configured badges and facts; details render groups in declared order. Media uses `ContentImage`; Markdown uses `MarkdownContent`; URL fields enforce HTTP(S), `noopener noreferrer`, and wrapping. Repeatable groups render semantic lists. Hidden placements are omitted.

- [ ] **Step 5: Enforce canonical and noindex metadata**

Every non-empty query, including only `page` or `sort`, receives `robots: { index: false, follow: true }`. Its canonical remains `publicUrl('/listings')`. The unfiltered first page remains indexable. The detail page and Markdown route read the same public projection; JSON-LD includes only allowlisted public scalar fields, and social-card input remains core/public only.

- [ ] **Step 6: Add responsive styles**

Use `minmax(0, 1fr)`, `min-width: 0`, wrapping, and stacked range/group controls below 640 pixels. Avoid fixed field widths. Preserve theme variables and visible focus indicators.

- [ ] **Step 7: Run PRF-003 browser and leak tests, then the full suite**

Run PRF-003, `npm test`, `npm run lint`, and `npm run build`.

- [ ] **Step 8: Commit and record the requirement pass**

Commit message: `feat: render profile facets and public values`

Close the lease, run `sudus check PRF-003`, and follow wake until the current reviewed detector passes.

---

### Task 11: Lock complete PRF-004 red coverage

**Files:**
- Modify: `tests/directory-profiles.test.mjs`
- Modify after declaration: `.sudus/mechanisms/directory-profiles.json`

**Interfaces:**
- Consumes: the installed add-on system, active profile lifecycle, normalized values, seed path, backup, and restore scripts.
- Produces: an independently reviewed PRF-004 red receipt for package, seed, import, removal, backup, restore, migration, and upgrade behavior.

- [ ] **Step 1: Extend the add-on package cases**

Pack and validate profile files with traversal, symlink, duplicate ID, mismatched identity/version, unknown type, unsafe default, invalid constraint, corrupt bytes, collision, incompatibility, install failure, and remove failure variants. Snapshot the database before every pack/validate/install/remove operation and assert it is unopened or unchanged.

- [ ] **Step 2: Add seed and operation cases**

Assert full-batch rejection for one late invalid typed record, profile-version mismatch, duplicate slugs, and unowned media. Assert same-digest retry creates zero rows. Back up and restore a database containing active/inactive definitions, site fields, current/archived values, migration history, and profile media; compare canonical row dumps.

- [ ] **Step 3: Run PRF-004 and verify an add-on/operations-specific failure**

- [ ] **Step 4: Commit and review the new detector digest**

Commit message: `test: define profile package and recovery behavior`

Run and review the PRF-004 fail receipt.

---

### Task 12: Extend add-on manifests and the reference package

**Files:**
- Modify: `scripts/addons/manifest.mjs`
- Modify: `scripts/addons/archive.mjs`
- Modify: `scripts/addons/workspace.mjs`
- Modify: `scripts/addons/registry.mjs`
- Modify: `.directory-starter/addons.lock.json`
- Modify: `fixtures/addons/reference-addon/directory-addon.json`
- Create: `fixtures/addons/reference-addon/src/ai-tools.profile.json`
- Modify: `fixtures/addons/reference-addon/seed/catalog.json`
- Test: `tests/addon-system.test.mjs`
- Test: `tests/directory-profiles.test.mjs`

**Interfaces:**
- Consumes: `parseDirectoryProfileDefinition`, package integrity maps, generated registries, and workspace transactions.
- Produces: `manifest.profiles: { id: string; version: string; schema: string }[]`, `template.supportedProfiles: { id: string; range: string }[]`, installed lock profile metadata, and discoverable installed sources without database access.

- [ ] **Step 1: Select the existing red manifest and archive cases**

Assert declaration/schema identity equality, semantic versions, unique namespaced IDs, safe `src/` JSON paths, 256 KiB limit, integrity inclusion, deterministic ordering, and template compatibility ranges. Instrument `better-sqlite3` or point `DATABASE_URL` at a forbidden path and prove validate/install/remove never opens it.

- [ ] **Step 2: Run PRF-004 and addon-system tests to verify the expected failures**

- [ ] **Step 3: Parse profile declarations during package validation**

Read each schema only from the already validated package file map. Parse JSON, enforce the shared runtime schema and byte limit, compare ID/version to the manifest declaration, and include normalized profile metadata in the manifest result. Keep all validation before workspace writes.

- [ ] **Step 4: Preserve ownership through install and removal**

Copy schema files through the existing namespaced target mapping, include source/target/bytes/hash/profile metadata in the lock, and generate an installed-profile registry from lock data. Removal deletes only owned package files and registry entries. It never imports application database modules.

- [ ] **Step 5: Upgrade the reference add-on**

Add a real `reference-addon.ai-tools` v1.0.0 profile with representative searchable text, pricing money, multi-choice platform, boolean open-source, URL, media, location, and repeatable integration fields. Declare it in the manifest, declare the template compatibility range, add its JSON to `files`, and update expected deterministic archives.

- [ ] **Step 6: Run add-on and PRF-004 package tests, then commit**

Run focused package cases, full `tests/addon-system.test.mjs`, PRF-004, and `npm test`.

Commit message: `feat: package versioned directory profiles`

---

### Task 13: Add typed idempotent seed and import enforcement

**Files:**
- Modify: `src/lib/addon-seed.ts`
- Modify: `src/lib/catalog-migrations.ts`
- Modify: `src/lib/agent-imports.ts`
- Modify: `scripts/addons.mjs`
- Modify: `fixtures/addons/reference-addon/seed/catalog.json`
- Test: `tests/directory-profiles.test.mjs`

**Interfaces:**
- Consumes: installed lock profile metadata, active stored definition/digest, `validateProfileValues`, `replaceListingProfileValues`, and `directory_profile_seed_runs`.
- Produces: seed shape `{ profile: { id, version }, listings: [...core, profileValues] }` and `seedInstalledAddon(root, addonId): { inserted: number; existing: number }`.

- [ ] **Step 1: Select the existing red full-batch and idempotency cases**

Use three records where the last has a wrong money currency or unowned media. Assert zero categories, listings, values, and seed-run rows. Retry a valid batch twice and assert the second result is `{ inserted: 0, existing: count }` with identical table dumps.

- [ ] **Step 2: Run PRF-004 and inspect the seed failure**

- [ ] **Step 3: Validate the complete batch before transaction**

Verify installed seed integrity, declared profile ID/version, active stored digest, unique slugs/destinations, core listing fields, every typed profile value, media ownership, and total row bounds before beginning writes. Existing identical seed provenance is an idempotent success; a conflicting prior slug or digest is an error.

- [ ] **Step 4: Apply the seed in one immediate transaction**

Insert categories, core listings, normalized profile values, FTS rows, and the seed-run digest. A thrown write rolls back all tables. Return counts and update CLI output to report inserted and existing rows.

- [ ] **Step 5: Enforce required profile fields on all agent publication routes**

Keep incomplete staged imports valid and private. Test direct publish, remote publish, browser-approved publish, and later edits; every route calls the same publishability function and preserves state on failure.

- [ ] **Step 6: Run seed, import, and full tests, then commit**

Commit message: `feat: seed and gate typed profile data`

---

### Task 14: Verify backup, isolated restore, upgrade, and operator procedures

**Files:**
- Modify: `scripts/ops-common.mjs`
- Modify: `docs/operator-manual.md`
- Test: `tests/directory-profiles.test.mjs`
- Test: `tests/restore-symlink-isolation.test.mjs`

**Interfaces:**
- Consumes: existing SQLite backup/restore archive, profile tables, canonical schema parser, and media paths.
- Produces: profile invariant validation in `inspectDatabase` and documented commands for installed source validation, activation, impact/mapping, site fields, seeds, backups, isolated restores, upgrades, and recovery.

- [ ] **Step 1: Select the existing red corruption and preservation cases**

Corrupt a stored definition digest, active-state reference, typed value column combination, archived-row definition reference, profile media file, and migration-history mapping in separate restored copies. `inspectDatabase` must reject each. A valid backup/restore must produce equal ordered dumps of every profile table and matching media hashes.

- [ ] **Step 2: Run PRF-004 and verify the operations failure**

- [ ] **Step 3: Validate profile invariants during backup and restore**

For each definition, parse JSON and recompute its digest. Resolve active state rows. Validate each current value against its stored definition version and ensure exactly the permitted typed columns are populated. Check media references and files. Validate change history references existing definitions and seed runs reference installed immutable definitions. Keep inspection read-only.

- [ ] **Step 4: Document the complete operator workflow**

Add a Directory profiles section before catalog authoring. Document validation/install, administrator activation, impact review, compatible upgrades, explicit mapping/archive for breaking changes, site fields, owner/operator permissions, explicit typed seed, removal behavior, purge, backup, isolated restore, upgrade, and recovery. State that add-on removal leaves database snapshots and values, and rollback uses the verified pre-upgrade restore because there is no downgrade command.

- [ ] **Step 5: Run operation, PRF-004, and full tests, then commit and record the pass**

Run PRF-004, restore isolation tests, `npm test`, `npm run lint`, and `npm run build`.

Commit message: `feat: preserve profiles through recovery workflows`

Close the lease, run `sudus check PRF-004`, and follow wake until its current reviewed detector passes.

---

### Task 15: Final mechanism, UI, security, and quality verification

**Files:**
- Modify only when a failing verification names a concrete defect: files owned by Tasks 2–14
- Modify if detector output needs clearer failure evidence: `tests/directory-profiles.test.mjs`, `mechanisms/check-directory-profiles.mjs`, `.sudus/mechanisms/directory-profiles.json`
- Create: Sudus review and adversarial report files at paths printed by `sudus wake`

**Interfaces:**
- Consumes: the complete implementation and all four reviewed requirement detectors.
- Produces: clean requirement receipts, repository checks, a production build, manual browser evidence, Ripwire quality/test gates, Sudus review answers, one fresh adversarial report, resolved findings, and the final Done record.

- [ ] **Step 1: Run every requirement independently**

Run:

```sh
sudus check PRF-001
sudus check PRF-002
sudus check PRF-003
sudus check PRF-004
```

Inspect every receipt output. Confirm each selected test executes nonzero assertions and cannot pass through skip/todo or shared setup failure.

- [ ] **Step 2: Run repository gates once**

Run:

```sh
npm test
npm run lint
npm run build
git diff --check
```

Expected: every command exits 0 with no hidden test failures or build warnings caused by this work.

- [ ] **Step 3: Run database and add-on recovery drills**

Create a temporary installed profile package, activate it, write all field families, switch versions with a mapping, archive one field, run an idempotent seed, remove the package, back up, restore in isolation, migrate the restored database, and query its public directory. Compare canonical database snapshots before removal and after restore for all retained profile data.

- [ ] **Step 4: Run browser verification**

At 320 and 1440 pixels in light and dark modes, verify `/admin/profiles`, `/admin/catalog`, `/owner/listings`, `/admin/review`, `/listings`, and one listing detail. Use keyboard-only navigation. Repeat public filtering with JavaScript disabled. Confirm no horizontal overflow and correct focus order, labels, errors, noindex, canonical URL, filter persistence, and public/private boundaries.

- [ ] **Step 5: Run Ripwire completion gates**

Run `ripwire . --edit-check=<each changed exported lifecycle/query symbol>`, `ripwire . --quality-delta`, and `ripwire . --test-gate`. Resolve every concrete regression before continuing.

- [ ] **Step 6: Complete the Sudus review sequence**

Follow `sudus wake` exactly: prepare the Q1–Q6 review with observed commands/paths/output; generate the brief; start exactly one fresh read-only adversarial subagent with only that brief; submit its report; resolve or decline every finding with reasons; rerun affected checks; and call `sudus done directory-profile-standard` only when the predicate holds.

- [ ] **Step 7: Report the printed Done record**

Show the developer the complete report printed by `sudus done`, including every finding and resolution, before promoting or starting another feature.
