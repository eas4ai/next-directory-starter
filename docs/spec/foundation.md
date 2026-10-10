# Foundation

Prefix: FOUND

[FOUND-001] The starter installs and builds as a current stable Next.js App Router application with TypeScript, React, and shadcn/ui components.
Falsifier: A fresh install cannot build, or the public layout uses neither React nor a shadcn/ui component.
Mechanism: foundation-app
Status: Agreed 2026-10-09

[FOUND-002] The operator configures the site name, public origin, description, and brand assets without editing application logic.
Falsifier: Changing the documented site configuration leaves the public header or site metadata with the old identity.
Mechanism: foundation-config
Status: Agreed 2026-10-09

[FOUND-003] The starter supplies documented setup and repeatable sample data without DevList branding or its production listings.
Falsifier: Following the setup guide fails to create a browsable sample directory, or a fresh sample page displays DevList branding.
Mechanism: foundation-setup
Status: Agreed 2026-10-09

[FOUND-004] The starter persists operator content through a documented database setup and migration process.
Falsifier: An operator-created listing disappears after a server restart, or a fresh database cannot apply the documented migrations.
Mechanism: foundation-storage
Status: Agreed 2026-10-09

[FOUND-005] The distributable starter includes the MIT license with the established copyright holder and preserves required notices for reused source and assets without bundling proprietary reference code, branding, or listings.
Falsifier: The distribution lacks the MIT grant or copyright notice, omits a required notice for copied material, or includes proprietary reference source, assets, branding, or production records.
Mechanism: operator-adoption
Status: Agreed 2026-10-10

[FOUND-006] A custom SQLite `DATABASE_URL` in `.env.local` selects the same database for the application, authentication migration, catalog migration, sample seed, and repository maintenance commands without a separate shell export. An explicit process environment value takes precedence. Existing data stays at its selected path, and the operator manual describes the resulting setup accurately.
Falsifier: On a fresh isolated installation with only `.env.local` naming a custom SQLite file, migration or seed creates or reads a different default database; a maintenance command targets that default; an exported `DATABASE_URL` is ignored; or the manual still says a shell export is required to avoid split databases.
Mechanism: cli-env-consistency
Status: Agreed 2026-10-10

[FOUND-007] The repository provides one documented command that runs every `tests/*.test.mjs` file without concurrent changes to the shared `.next` build output. Migration fixtures represent the schema versions they claim are already applied, and HTTP access assertions reflect the current staff role permissions.
Falsifier: The documented test command omits a test file or fails from concurrent builds, a migration fixture claims applied versions while missing their tables, or an HTTP test expects access that the declared role is denied.
Mechanism: test-suite
Status: Agreed 2026-10-10
