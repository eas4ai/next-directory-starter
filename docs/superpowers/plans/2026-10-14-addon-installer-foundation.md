# Add-on Installer Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a safe, reproducible add-on package format and CLI that installs and removes theme/template bundles from a clean Next Directory Starter.

**Architecture:** A small Node CLI validates a canonical JSON manifest, reads and writes deterministic ZIP archives, and owns a namespaced package layout. A lockfile is the authority for installed identity and file ownership; generated TypeScript and CSS files provide the static imports Next.js needs. Database seeding is an explicit command separated from source installation and removal.

**Tech Stack:** Node.js ESM, Zod 4, semver, yauzl/yazl, SHA-256, Next.js 16, TypeScript, SQLite, Node test runner

**Spec:** `docs/superpowers/specs/2026-10-14-addon-installer-foundation-design.md`

## Global Constraints

- Manifest schema version is exactly `1`; the starter add-on API version is exactly `1`.
- Add-on IDs and contributed theme/template IDs match `^[a-z][a-z0-9-]*$`.
- Payload paths use normalized relative POSIX paths and remain under `src/`, `public/`, or `seed/`.
- Installed payloads remain under `src/addons/<id>/` and `public/addons/<id>/`.
- Install and removal never open or mutate the operator database.
- Removal refuses any owned file whose SHA-256 differs from the lock.
- Equal manifest and payload bytes produce byte-identical ZIP bytes.
- Schema version 1 has no in-place upgrade operation.

## Review Focus

- ZIP path aliases such as backslashes, repeated separators, `.` segments, Unicode ambiguity, and case-only collisions must fail before extraction.
- Archive metadata that identifies a symlink, device, or directory/file conflict must never become a workspace path.
- A crash or injected write failure after the first destination replacement must restore the lock, generated files, and package roots.
- Two manifests contributing the same theme or template ID must fail even when their add-on IDs differ.
- Explicit seeding against a selected `DATABASE_URL` must be repeatable and removal must leave the seeded rows intact.

---

## File structure

- `scripts/addons.mjs`: command parser and user-facing output only.
- `scripts/addons/manifest.mjs`: schema parsing, path normalization, identity validation, and target mapping.
- `scripts/addons/archive.mjs`: deterministic ZIP packing and safe archive reading with integrity verification.
- `scripts/addons/registry.mjs`: lock parsing and deterministic TypeScript/CSS generation.
- `scripts/addons/workspace.mjs`: preflight, staged install, rollback, guarded removal, and starter-root checks.
- `src/addons/generated.ts`: committed empty registry replaced deterministically after add-on changes.
- `src/addons/generated.css`: committed empty stylesheet entrypoint replaced deterministically after add-on changes.
- `.directory-starter/addons.lock.json`: committed schema-1 empty ownership record.
- `src/lib/addon-seed.ts`: validated explicit insertion of one installed package's sample catalog.
- `tests/addon-system.test.mjs`: black-box contract and clean-copy acceptance coverage.
- `mechanisms/check-addon-system.mjs`: independent per-requirement Sudus results.

### Task 1: Manifest, compatibility, and deterministic archives

**Files:**
- Create: `scripts/addons/manifest.mjs`
- Create: `scripts/addons/archive.mjs`
- Create: `scripts/addons.mjs`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `tests/addon-system.test.mjs`
- Modify: `mechanisms/check-addon-system.mjs`
- Test: `tests/addon-system.test.mjs`

**Interfaces:**
- Produces: `readSourcePackage(path): Promise<ValidatedPackage>`
- Produces: `readArchive(path): Promise<ValidatedPackage>`
- Produces: `packAddon(source, output): Promise<PackageSummary>`
- Produces: `validateCompatibility(manifest, starter): void`
- Produces: CLI verbs `pack` and `validate`

- [ ] **Step 1: Make the mechanism run each requirement independently**

Replace direct `test(...)` registration with a helper that honors `ADDON_REQUIREMENT`, then run the test file once per requirement from the mechanism:

```js
const selectedRequirement = process.env.ADDON_REQUIREMENT;
function requirementTest(name, body) {
  if (!selectedRequirement || name.startsWith(selectedRequirement)) test(name, body);
}

for (const requirement of requirements) {
  const run = spawnSync("node", testArgs, {
    env: { ...process.env, CI: "1", ADDON_REQUIREMENT: requirement },
  });
  const passed = tapRunPassed(run.status, run.stdout ?? "") &&
    tapTestPassed(run.stdout ?? "", requirement);
  process.stdout.write(`sudus: ${requirement}: ${passed ? "pass" : "fail"}\n`);
}
```

- [ ] **Step 2: Run the focused ADD-001 test and verify the missing CLI fails**

Run: `ADDON_REQUIREMENT=ADD-001 node --import tsx --test tests/addon-system.test.mjs`

Expected: FAIL with `add-on CLI is missing`.

- [ ] **Step 3: Add dependencies, scripts, and the starter compatibility identity**

Set the private package version to `1.2.0`, add `directoryStarter.addonApi: 1`, install `semver`, `yauzl`, and `yazl`, and expose:

```json
{
  "addon:validate": "node scripts/addons.mjs validate",
  "addon:pack": "node scripts/addons.mjs pack",
  "addon:install": "node scripts/addons.mjs install",
  "addon:remove": "node scripts/addons.mjs remove",
  "addon:seed": "node --import ./scripts/load-env.mjs --import tsx scripts/addons.mjs seed"
}
```

- [ ] **Step 4: Implement strict manifest and payload validation**

Define and export the manifest parser and target mapper:

```js
export const ADDON_SCHEMA_VERSION = 1;
export const ADDON_API_VERSION = 1;
export function parseManifest(input) {
  const manifest = manifestSchema.strict().parse(input);
  const themeIds = manifest.themes.map(({ id }) => id);
  const templateIds = manifest.templates.map(({ id }) => id);
  if (new Set(themeIds).size !== themeIds.length) throw new Error("Duplicate theme ID");
  if (new Set(templateIds).size !== templateIds.length) throw new Error("Duplicate template ID");
  return manifest;
}
export function normalizePayloadPath(value) {
  if (typeof value !== "string" || value !== value.normalize("NFC") ||
      value.includes("\\") || value.startsWith("/") || value.endsWith("/") ||
      value.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error(`Unsafe payload path: ${value}`);
  }
  return value;
}
export function targetForPayload(addonId, path) {
  if (path.startsWith("src/")) return `src/addons/${addonId}/${path.slice(4)}`;
  if (path.startsWith("public/")) return `public/addons/${addonId}/${path.slice(7)}`;
  if (path.startsWith("seed/")) return `src/addons/${addonId}/seed/${path.slice(5)}`;
  throw new Error(`Unsupported payload root: ${path}`);
}
```

Reject empty arrays where the contract requires a contribution, duplicate normalized paths, duplicate contributed IDs, undeclared entry paths, unlisted source files, links, non-files, and a target collision caused by source/seed mapping.

- [ ] **Step 5: Implement deterministic ZIP creation and safe reads**

Use sorted entries, a fixed `1980-01-01T00:00:00.000Z` timestamp, mode `0o100644`, canonical JSON, and SHA-256 integrity metadata:

```js
const integrity = {
  schemaVersion: 1,
  files: files.map(({ path, bytes }) => ({
    path, bytes: bytes.length, sha256: sha256(bytes),
  })),
};
```

Read with `yauzl` in lazy-entry mode. Reject encrypted entries, noncanonical names, duplicate names, unsupported external mode bits, missing or extra files, size mismatches, and digest mismatches before returning bytes.

- [ ] **Step 6: Implement `pack` and `validate` CLI verbs**

`pack` accepts exactly a source directory and output ZIP; `validate` accepts exactly a source directory or ZIP. `validate` compares `compatibility.starter` with `package.json.version` and `compatibility.addonApi` with `package.json.directoryStarter.addonApi` when run in a starter root.

- [ ] **Step 7: Run the focused contract and quality checks**

Run:

```bash
ADDON_REQUIREMENT=ADD-001 node --import tsx --test tests/addon-system.test.mjs
node mechanisms/check-addon-system.mjs
npx eslint scripts/addons.mjs scripts/addons/*.mjs tests/addon-system.test.mjs
```

Expected: focused ADD-001 PASS; mechanism reports ADD-001 pass and ADD-002/ADD-003 fail; ESLint PASS.

- [ ] **Step 8: Commit Task 1**

```bash
git add package.json package-lock.json scripts/addons.mjs scripts/addons tests/addon-system.test.mjs mechanisms/check-addon-system.mjs docs/superpowers/plans/2026-10-14-addon-installer-foundation.md
git commit -m "Add deterministic add-on package validation"
```

### Task 2: Static registries and transactional installation

**Files:**
- Create: `scripts/addons/registry.mjs`
- Create: `scripts/addons/workspace.mjs`
- Create: `src/addons/generated.ts`
- Create: `src/addons/generated.css`
- Create: `.directory-starter/addons.lock.json`
- Modify: `src/themes/index.ts`
- Modify: `src/lib/theme-selection.ts`
- Modify: `src/app/globals.css`
- Modify: `scripts/addons.mjs`
- Test: `tests/addon-system.test.mjs`

**Interfaces:**
- Consumes: `ValidatedPackage`, `targetForPayload`, `readArchive`
- Produces: `readAddonLock(root): AddonLock`
- Produces: `generateRegistries(lock): { typescript: string, css: string }`
- Produces: `installAddon(root, archive, options?): Promise<MutationSummary>`

- [ ] **Step 1: Run ADD-002 and verify installation fails at the missing verb**

Run: `ADDON_REQUIREMENT=ADD-002 node --import tsx --test tests/addon-system.test.mjs`

Expected: FAIL when `install` is unavailable.

- [ ] **Step 2: Commit the empty static seam**

Create an empty schema-1 lock and generated exports:

```ts
import type { ThemeDefinition } from "@/lib/theme-sdk";

export const addonThemeDefinitions: ThemeDefinition[] = [];
export const addonTemplateOptions: readonly { id: string; name: string }[] = [];
```

Import those arrays from the built-in theme and template registries, and import `../addons/generated.css` once from `globals.css`.

- [ ] **Step 3: Generate registries from a sorted lock**

Sort add-ons by ID, themes and templates by ID, quote all generated strings with `JSON.stringify`, and emit static imports such as:

```ts
import referenceAddonTheme0 from "./reference-addon/theme";
export const addonThemeDefinitions = [referenceAddonTheme0];
export const addonTemplateOptions = [{ id: "reference-addon", name: "Reference Grid" }] as const;
```

The CSS generator emits only sorted top-level `@import "./<id>/<stylesheet>";` lines.

- [ ] **Step 4: Preflight all identities and targets**

Read built-in theme and template IDs, the lock, every owned target, and generated outputs before writing. Reject an existing add-on ID, built-in or installed contributed ID, target path, malformed lock, changed generated file, and archive digest mismatch.

- [ ] **Step 5: Install through a staged mutation with rollback**

Write package files and all generated outputs to a sibling temporary directory. Snapshot bytes or absence for every destination, rename staged files into place, write the lock last, and on any exception restore each destination in reverse order. Honor `DIRECTORY_ADDON_TEST_FAIL_AFTER` only when `NODE_ENV=test` so the contract can force the rollback branch.

- [ ] **Step 6: Run focused tests and the production TypeScript check**

Run:

```bash
ADDON_REQUIREMENT=ADD-002 node --import tsx --test tests/addon-system.test.mjs
npx tsc --noEmit
```

Expected: installation, duplicate rejection, rollback, and registry assertions pass up to the guarded removal cases; TypeScript PASS.

- [ ] **Step 7: Commit Task 2**

```bash
git add .directory-starter package.json scripts/addons.mjs scripts/addons src/addons src/themes/index.ts src/lib/theme-selection.ts src/app/globals.css tests/addon-system.test.mjs
git commit -m "Install add-ons through generated registries"
```

### Task 3: Guarded removal and deterministic multi-package state

**Files:**
- Modify: `scripts/addons/registry.mjs`
- Modify: `scripts/addons/workspace.mjs`
- Modify: `scripts/addons.mjs`
- Test: `tests/addon-system.test.mjs`

**Interfaces:**
- Consumes: `readAddonLock`, `generateRegistries`
- Produces: `removeAddon(root, addonId): Promise<MutationSummary>`

- [ ] **Step 1: Add a duplicate contributed-ID package case**

Derive a second fixture whose add-on ID changes while its theme ID remains `reference-addon`; installation after the reference package must fail without changing the tree.

- [ ] **Step 2: Verify drifted removal and multi-package ordering fail**

Run: `ADDON_REQUIREMENT=ADD-002 node --import tsx --test tests/addon-system.test.mjs`

Expected: FAIL at the first unimplemented removal or deterministic ordering assertion.

- [ ] **Step 3: Implement guarded removal**

Validate every lock-owned path and digest before mutation. Refuse missing, changed, linked, or non-file owned paths. Generate the remaining lock and registries before removing files, reuse the install transaction rollback helper, and remove only empty package-owned directories.

- [ ] **Step 4: Verify fallback compatibility**

After removal, spawn a fresh `tsx` process and assert `parseThemeSelection({ themeId: "reference-addon", templateId: "reference-addon" })` returns `null`, preserving the existing runtime fallback path.

- [ ] **Step 5: Run ADD-002 and project checks**

Run:

```bash
ADDON_REQUIREMENT=ADD-002 node --import tsx --test tests/addon-system.test.mjs
npx tsc --noEmit
npm run lint
```

Expected: all PASS.

- [ ] **Step 6: Commit Task 3**

```bash
git add scripts/addons.mjs scripts/addons tests/addon-system.test.mjs
git commit -m "Remove add-ons without losing local changes"
```

### Task 4: Explicit sample seeding and clean-copy acceptance

**Files:**
- Create: `src/lib/addon-seed.ts`
- Modify: `src/lib/catalog-migrations.ts`
- Modify: `scripts/addons.mjs`
- Modify: `package.json`
- Test: `tests/addon-system.test.mjs`

**Interfaces:**
- Produces: `parseAddonSeed(input): ListingInput[]`
- Produces: `seedCatalogRecords(records): void`
- Produces: CLI verb `seed <installed-addon-id>`

- [ ] **Step 1: Run ADD-003 and verify explicit seeding fails**

Run: `ADDON_REQUIREMENT=ADD-003 node --import tsx --test tests/addon-system.test.mjs`

Expected: FAIL because `addon:seed` is unavailable.

- [ ] **Step 2: Extract repeatable record seeding**

Refactor the existing fixture seeding so both built-in and add-on records use one transaction:

```ts
export function seedCatalogRecords(records: unknown[]): void {
  migrateCatalog(true);
  database.transaction(() => insertRows(records))();
}

export function seedCatalog(): void {
  seedCatalogRecords(defaultRecords);
}
```

Keep `parseListing`, destination normalization, category insertion, existing-slug idempotency, and current status validation.

- [ ] **Step 3: Validate and seed only the named installed package**

Read the lock, require a declared seed path, verify its current owned hash, parse an exact `{ listings: [...] }` object, and call `seedCatalogRecords`. Do not expose a seed path supplied outside the lock.

- [ ] **Step 4: Run the full clean-copy round trip**

Run: `ADDON_REQUIREMENT=ADD-003 node --import tsx --test tests/addon-system.test.mjs`

Expected: deterministic pack, install without database creation, production build, explicit migration and seed, retained seeded row after removal, and baseline source comparison all PASS.

- [ ] **Step 5: Commit Task 4**

```bash
git add src/lib/addon-seed.ts src/lib/catalog-migrations.ts scripts/addons.mjs package.json package-lock.json tests/addon-system.test.mjs
git commit -m "Seed optional add-on sample catalogs explicitly"
```

### Task 5: Operator guidance and complete verification

**Files:**
- Modify: `README.md`
- Modify: `docs/operator-manual.md`
- Modify: `.agents/skills/create-directory-theme/SKILL.md`
- Modify: `mechanisms/addon-system.def.json`
- Modify: `tests/addon-system.test.mjs`

**Interfaces:**
- Consumes: all five CLI commands and manifest schema 1
- Produces: source-linked authoring, install, seed, removal, and recovery guidance

- [ ] **Step 1: Document the package lifecycle**

Add exact commands for validation, packing, installation, explicit seeding, and removal. State the namespaced paths, compatibility fields, drift refusal, no-upgrade limit, and that install/remove never mutate the database.

- [ ] **Step 2: Update the theme creation skill**

Teach the skill to author `directory-addon.json`, keep IDs and paths namespaced, run `addon:pack` and `addon:validate`, and use direct registry edits only for built-in designs.

- [ ] **Step 3: Run the bound mechanism and project gates**

Run:

```bash
node mechanisms/check-addon-system.mjs
npm test
npx tsc --noEmit
npm run lint
npm run build
```

Expected: all three ADD results pass; test, type, lint, and build commands exit zero.

- [ ] **Step 4: Run Ripwire completion checks**

Run:

```bash
ripwire . --edit-check=readArchive
ripwire . --edit-check=installAddon
ripwire . --edit-check=removeAddon
ripwire . --quality-delta
ripwire . --test-gate
```

Expected: no newly introduced unresolved critical risk and the affected test gate names the add-on contract tests.

- [ ] **Step 5: Commit Task 5**

```bash
git add README.md docs/operator-manual.md .agents/skills/create-directory-theme/SKILL.md mechanisms/addon-system.def.json tests/addon-system.test.mjs
git commit -m "Document the directory add-on workflow"
```

- [ ] **Step 6: Continue the Sudus review loop**

Run `sudus check ADD-001`, `sudus check ADD-002`, and `sudus check ADD-003` after their implementation commits, then follow each action named by `sudus wake` through review, adversarial report, resolution, and Done.
