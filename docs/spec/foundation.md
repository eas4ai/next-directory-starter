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
