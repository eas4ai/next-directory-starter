# Operator manual brief

This is the scope and evidence checklist for the operator manual to be written after the README overview. It is not the finished manual. The manual must derive every command, field, limit, access rule, and operational claim from executable source, package scripts, configuration readers, and relevant tests. Earlier Markdown prose is a review target, not evidence.

## Verify against source

For every procedure, follow the UI or API entry point to the server function and persistence or external-service effect. Confirm the normal path, authorization, missing configuration, stale state, retry behavior, and how the operator verifies success. Run the documented commands in an isolated environment where practical. Mark external-provider steps as conditional; do not infer live behavior from test-mode code or a browser return. Record the source paths and observed check beside each chapter draft. Avoid real keys, addresses, and customer data in examples.

## Chapters

### 1. First installation and local sample

Explain dependencies, environment values needed for a local start, SQLite migration, repeatable sample seed, first administrator provision, and starting the dev server. Validate each command against [package scripts](../package.json), the [database URL reader](../src/lib/database.ts), [migration and seed functions](../src/lib/catalog-migrations.ts), and [sample fixture loader](../scripts/seed-catalog.ts). Demonstrate the resulting public listing index and administrator sign-in from their routes. Verify which values are required for production in the actual config readers before writing a production variant.

### 2. Site identity and design

Walk through site name, description, logo, icon, social image, saved preset, registered theme, template, and visitor appearance. Check accepted asset URLs and saved-setting precedence in [site configuration](../src/lib/site-config.ts), [branding uploads](../src/lib/branding.ts), [theme selection](../src/lib/theme-selection.ts), [theme validation](../src/lib/theme-sdk.ts), and [root layout](../src/app/layout.tsx). Separate what an administrator can choose in the UI from what a developer registers in code. Verify invalid-asset and removed-theme behavior.

### 3. Catalog and public browsing

Cover operator-created listings, categories, draft/published/suspended status, public search/filter/pagination, and destination links. Check field validation and URL rules in [catalog input](../src/lib/catalog-input.ts), [listing queries](../src/lib/listings.ts), and [catalog editor](../src/app/admin/catalog/catalog-editor.tsx). Explain that the directory model is a curated outbound link entry; use the implemented fields when giving vertical examples. Show how sample records are replaced without overwriting existing operator content.

### 4. Accounts, owners, staff, and review

Document signup, email verification, password recovery, verified-account sign-in links, account suspension, role assignment, owner drafts, submissions, approvals, rejections, and suspended listings. Trace [authentication](../src/lib/auth.ts), [role checks](../src/lib/admin.ts), [account controls](../src/lib/accounts.ts), [owner/reviewer transitions](../src/lib/moderation.ts), and [staff-role composition](../src/lib/staff-roles.ts). Show what stays public during pending edits and what is withdrawn on suspension. Verify the final-administrator guard and how notices enter an owner's workspace.

### 5. Articles, taxonomy, and media

Explain article creation, saved revisions, private previews, publication, category/tag editing, search, RSS, and draft/public image selection. Check [article state changes](../src/lib/articles.ts), [taxonomy rules](../src/lib/taxonomy.ts), [media assignment and eligibility](../src/lib/media.ts), [article index](../src/app/articles/page.tsx), and [RSS output](../src/app/feed.xml/route.ts). Include format and size limits from code, and test withdrawal of a public article and its image.

### 6. Search visibility and social sharing

Describe canonical metadata, site verification, public-only sitemap, per-page SEO overrides, previews/findings, redirects/missing paths, Markdown routes and negotiation, and generated social cards. Follow [metadata selection](../src/lib/page-metadata.ts), [SEO settings](../src/lib/seo-settings.ts), [SEO findings and previews](../src/lib/seo-findings.ts), [redirects](../src/lib/seo-redirects.ts), [sitemap](../src/app/sitemap.ts), [Markdown proxy](../src/proxy.ts), and [card rendering](../src/lib/social-cards.ts). Validate initial HTML and image dimensions from a production build. Live crawler checks require a deployed public URL; distinguish that from the local test.

### 7. Agent-assisted catalog imports

Document the two access paths separately: a staff-issued key for remote MCP, and a catalog-authorized session on `/admin/import` for WebMCP in supported browsers. Then cover listing categories, staging observed URLs with source excerpts, attaching a screenshot, previewing a card, reviewing private imports, and publishing explicitly. Check [remote MCP tool definitions](../src/app/api/mcp/route.ts), [browser WebMCP registration](../src/app/admin/import/import-workspace.tsx), [catalog access gate](../src/app/admin/import/page.tsx), [key management](../src/lib/agent-keys.ts), [import validation and duplicate handling](../src/lib/agent-imports.ts), and [card rendering](../src/lib/agent-cards.ts). Verify authentication, provenance, batch limit, invalid URL handling, and publication boundaries for both paths. Do not claim the server crawls a URL on its own.

### 8. Plans, providers, and owner billing

Separate free, one-time, monthly, and annual plans; test/live mode; featured placement; provider profiles; hosted checkout; signed webhooks; recurring cancellation; refunds/disputes; and reconciliation. Check [plan validation](../src/lib/plans.ts), [profile requirements and secret handling](../src/lib/billing-profiles.ts), [hosted session creation](../src/lib/payment-provider.ts), [verified event effects](../src/lib/payment-lifecycle.ts), [owner billing](../src/lib/owner-billing.ts), and [reconciliation](../src/lib/payment-reconciliation.ts). Provider-specific setup steps need both source checks and a test-mode run with the relevant provider. State which plans each provider actually supports. Never treat a checkout return URL as payment confirmation.

### 9. Notifications and recurring jobs

Explain owner notices, Resend email delivery, bounded retries, exhausted jobs, administrator retry, and the scheduled command. Follow [notice records](../src/lib/notifications.ts), [delivery claims and idempotency](../src/lib/notification-delivery.ts), and [delivery command](../scripts/deliver-notifications.ts). Show what to inspect before retrying an outcome that the provider may have accepted. Keep private message contents and addresses out of diagnostics.

### 10. Deployment, backups, restore, and upgrades

Build a production checklist from the [public-origin validator](../src/lib/page-metadata.ts), [database URL reader](../src/lib/database.ts), [media storage](../src/lib/media.ts), and [build/start scripts](../package.json). For backups, verify the matching billing key, isolated target, file hashes, and refusal to overwrite or overlap live storage from [backup](../scripts/backup.mjs), [restore](../scripts/restore.mjs), and [shared checks](../scripts/ops-common.mjs). For upgrades, confirm the actual migration behavior and lockfile-based install path before giving a rollback procedure. Test a restore into a separate directory, including an uploaded image and decryptable provider profile.

## Manual acceptance checks

- Every command in the manual exists in package scripts or an executable script and has been run in a disposable environment when possible.
- Each UI procedure names who can perform it and how success or failure appears.
- Public versus draft behavior is checked at a server route, not inferred from a form label.
- Paid-placement claims are conditional on current verified entitlements, not checkout initiation.
- External-service instructions name required configuration and distinguish local checks from live provider validation.
- Backup and upgrade procedures include recoverability checks before changing a live installation.
