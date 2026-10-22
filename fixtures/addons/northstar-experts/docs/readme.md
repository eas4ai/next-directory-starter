# NORTHSTAR Experts Directory

NORTHSTAR is a complete experts and consultants directory product for Next Directory Starter 1.2 or later. It includes a calm cream, navy, and sage theme; server-rendered public layouts; a versioned experts profile; an original brand mark; and eight original environmental portraits.

## Install

```sh
npm run addon:validate -- ./northstar-experts.zip
npm run addon:install -- ./northstar-experts.zip
npm run db:migrate
npm run build
```

In `/admin/profiles`, analyze and activate `northstar-experts.experts@1.0.0`. In `/admin/theme`, preview and select the NORTHSTAR theme and template. Sample data remains opt in:

```sh
npm run addon:seed -- northstar-experts
```

Installation copies owned source only. It does not select the design, activate the profile, open the operator database, or create runtime media. The explicit seed adds fourteen fictional experts, including one draft that demonstrates public eligibility. Repeating the same seed is idempotent.

## Product behavior

- Search, specialty, sector, engagement, location, language, experience, rate, availability, review, and date controls submit ordinary GET forms and retain state through pagination.
- Expert cards show specialty, location, starting rate, current stated availability, and operator credential-review state before decorative proof.
- Credential review and its date are operator-owned facts. The add-on does not present them as client endorsements.
- Inquiry links open each expert’s public contact page. The directory does not claim booking, response, or verification by a client.
- Public home, directory, detail, metadata, Markdown, structured data, and social images read current eligible server data and work without client JavaScript.

## Media and removal

Packaged images are original fictional portraits. Explicit seeding validates and normalizes them to runtime WebP files in the same transaction as their catalog records. A failure rolls back database rows and removes newly written files. Removing NORTHSTAR deletes unchanged package source while preserving explicitly seeded operator data and media. A selected NORTHSTAR design falls back to the starter defaults.

## Customization

Visual tokens live in `src/theme.ts`; composition and responsive behavior live in `src/template.tsx` and `src/template.css`. Preserve the six-pixel geometry, restrained spacing, direct qualification and availability hierarchy, and distinct navy action and sage support roles when extending the product.
