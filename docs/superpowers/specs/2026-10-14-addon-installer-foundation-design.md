# Add-on installer foundation design

## Goal

Give a clean Next Directory Starter installation a stable way to consume sold
or locally authored theme and template add-ons. Packages must install without
hand-editing the theme registry, template registry, or global CSS imports, and
must be removable without guessing which files they own.

The first package is a noncommercial fixture. The ten product designs, starting
with VECTOR, will use the same contract after their visual work is complete.

## Package contract

Each add-on source contains `directory-addon.json` plus only the files listed by
that manifest. Schema version 1 records:

- add-on ID, display name, and SemVer version;
- a compatible starter SemVer range and add-on API version;
- theme IDs, names, and TypeScript entry modules;
- template IDs, names, and CSS entry files;
- namespaced public assets;
- an optional sample-catalog JSON entry; and
- the complete relative payload file list.

The packer validates the source, orders every archive entry by normalized POSIX
path, fixes ZIP timestamps and permissions, and writes a canonical integrity
record with each payload's byte length and SHA-256 digest. It rejects unlisted
files, absolute paths, traversal, backslashes, duplicate normalized paths,
links, devices, and entries outside the supported source, public, and seed
roots. Identical source bytes and metadata therefore produce identical ZIP
bytes.

## Starter compatibility

The starter exposes its release version and integer add-on API version as
machine-readable configuration. Validation compares both before extraction.
The first installer-bearing source advances the starter's package version from
the historical private-package placeholder to the next development version;
future releases update it with their normal release preparation.

## Installation layout

An installed add-on can write only beneath these package-owned roots:

```text
src/addons/<addon-id>/
public/addons/<addon-id>/
```

Starter-owned generated files remain stable integration points:

```text
src/addons/generated.ts
src/addons/generated.css
.directory-starter/addons.lock.json
```

`generated.ts` uses static imports and exports validated theme definitions and
template options. `src/themes/index.ts` combines built-in themes with generated
themes, while `src/lib/theme-selection.ts` combines built-in templates with
generated template options. `globals.css` imports one generated stylesheet,
which in turn imports installed template CSS in add-on ID order. This keeps
Next.js and Tailwind compilation static and makes registry output independent
of installation order.

## Transaction and ownership model

Validation and output generation finish in a temporary staging directory before
workspace writes begin. The installer snapshots every destination it will
replace, applies staged files through same-filesystem renames, and restores the
snapshot if a write fails. The lock is written last and records the manifest,
archive digest, declared IDs, and SHA-256 for every owned file.

Removal recalculates owned hashes before changing anything. It refuses if an
owned file differs from the lock, then stages regenerated registries and removes
only paths listed for that add-on. It does not remove parent directories it does
not own. If the removed theme or template remains in saved site settings, the
existing parser rejects it and falls back to the saved preset and Classic
template.

Schema version 1 supports fresh installation and guarded removal. Replacing an
installed add-on with another version is deferred until an upgrade contract can
define migrations and conflict policy explicitly.

## Optional sample catalog

Installation and removal never open the application database. A package may
declare a validated sample-catalog JSON file. An operator can run a separate,
explicit seed command naming the installed add-on. The seed action uses the
existing database selection rules and repeatable catalog primitives. Removing
source files does not delete previously seeded data.

## Commands

Package scripts expose one CLI through focused commands:

```text
npm run addon:validate -- <archive-or-source>
npm run addon:pack -- <source-directory> <output.zip>
npm run addon:install -- <archive.zip>
npm run addon:remove -- <addon-id>
npm run addon:seed -- <addon-id>
```

Each mutating command reports the add-on identity and changed paths. Validation
and packing may run outside a starter checkout; installation, removal, and seed
verify the starter root before acting.

## Reference package and verification

The repository contains a deliberately generic reference package with a full
theme definition, scoped template stylesheet, namespaced public asset, and
sample catalog. Tests copy the starter into an isolated temporary directory and
exercise:

1. malformed manifests, incompatible versions, unsafe archive entries,
   corrupted payloads, duplicate identities, and target collisions;
2. install visibility through the runtime theme and template registries;
3. deterministic registries regardless of package installation order;
4. rollback after an injected write failure;
5. a production build with the installed reference package;
6. explicit sample seeding with no install-time database mutation;
7. refusal to remove a locally changed owned file; and
8. clean removal followed by a tracked-source comparison with the baseline.

The normal TypeScript, lint, test-suite, and production-build checks remain the
release gate.
