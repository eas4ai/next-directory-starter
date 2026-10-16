# Installable add-ons

Prefix: ADD

[ADD-001] The starter provides a versioned manifest and documented commands to validate, pack, install, and remove a directory add-on. A manifest names the add-on identity and version, its compatible starter and add-on API range, every theme and template identity, its source and public payload, and any optional sample catalog. Validation completes before installation writes and rejects a malformed or incompatible manifest, an unsafe archive entry, a missing or changed declared file, a duplicate add-on, theme, or template identity, and any target path the add-on does not exclusively own.
Falsifier: A malformed, incompatible, corrupt, traversal-bearing, symlink-bearing, duplicate-ID, or colliding package changes the starter workspace or installed-add-on record, or a valid compatible package cannot be validated from its distributable archive.
Mechanism: addon-system
Status: Agreed 2026-10-14

[ADD-002] Installing a valid add-on copies its payload only into namespaced source and public directories, records its version, digest, identities, and owned file hashes in an installed-add-on lock, and deterministically regenerates static TypeScript and CSS registries consumed by the existing theme SDK and template selector. A failed install leaves the workspace unchanged. Removing an add-on removes only unchanged files it owns, refuses when an owned file has drifted, regenerates the registries, and preserves the existing safe fallback when the removed theme or template was selected. Installation and removal do not modify an operator database.
Falsifier: An installed theme or template is absent from the existing administrator preview and selection flow or a production build, registry output depends on installation order, a failed operation leaves a partial file or lock change, removal deletes an unrelated or locally changed file, or removing the selected design takes the application offline instead of falling back.
Mechanism: addon-system
Status: Agreed 2026-10-14

[ADD-003] The repository includes a noncommercial reference add-on with a custom theme, public template, namespaced public asset, and optional sample catalog. Packing the same validated source twice produces byte-identical ZIP archives without machine-local content. In an isolated clean starter copy, the reference archive validates, installs, builds, can explicitly seed its sample catalog, and removes back to the original tracked source state apart from ignored build output; install and removal never apply or delete sample data implicitly.
Falsifier: The reference package omits a named payload type, equal inputs produce different archive bytes, the archive fails a validate-install-build-explicit-seed-remove round trip in a clean copy, installation mutates the database without an explicit seed action, removal deletes seeded operator data, or the final tracked source differs from its pre-install state.
Mechanism: addon-system
Status: Agreed 2026-10-14
