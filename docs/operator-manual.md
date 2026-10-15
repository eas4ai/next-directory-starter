# Operator manual

This manual covers the workflows implemented by this repository. Run shell commands from the repository root unless a step says otherwise. Replace example domains, addresses, and paths with your own values. A listing is an outbound link entry; the application does not host the destination. The [README](../README.md) gives the shorter product overview.

Each section links to the application code or executable script that supports its instructions. Provider dashboards, DNS, hosting platforms, and mail-domain verification are external systems; their screens and requirements are outside this codebase. Complete their setup using the provider's current documentation, then use the configuration and verification points below.

## 1. Install and open a local directory

1. Install the locked dependencies and create a local environment file:

   ```sh
   npm ci
   cp .env.example .env.local
   ```

2. Set a new `BETTER_AUTH_SECRET` in `.env.local`. Set `BETTER_AUTH_URL` and `SITE_URL` to the origin where you will open the site; the example uses `http://localhost:3000`. Keep `DATABASE_URL=file:./.runtime/directory.db` for the first run, or choose a persistent SQLite file. The database reader creates its parent directory. Uploaded images default to a `media` directory beside that database unless `MEDIA_DIR` is set. See [the configuration reader](../src/lib/database.ts), [media storage](../src/lib/media.ts), and [public-origin validation](../src/lib/page-metadata.ts).

3. For a custom SQLite path, set `DATABASE_URL=file:/absolute/path/to/directory.db` in `.env.local` and run the repository commands from its root. The application, Better Auth migration, catalog migration, seed, and `tsx` or `node` maintenance entry points then select that same file without a separate shell export. An explicit process environment value takes precedence when you intentionally target another database, such as an isolated restore. For example, in the shell running a one-off command:

   ```sh
   export DATABASE_URL='file:/absolute/path/to/other.db'
   ```

   A mode-specific file such as `.env.production.local` takes precedence when its mode is selected. Operational commands use the production file order when `NODE_ENV` is unset, matching `next build` and `next start`. Set `NODE_ENV=development` or `NODE_ENV=test` to select those file orders explicitly; test mode follows Next.js behavior and does not load `.env.local`. Check which file supplies the database path, and set the working directory for scheduled jobs to the repository root or provide their environment explicitly. See [CLI environment loading](../scripts/load-env.mjs), [package scripts](../package.json), and [database connection](../src/lib/database.ts).

4. Create the authentication and catalog tables, add repeatable sample listings, and create the first administrator:

   ```sh
   npm run db:migrate
   npm run db:seed
   npm run account:provision -- --email you@example.com --name "Site administrator"
   npm run dev
   ```

   The provisioner prompts for a password. Open `http://localhost:3000/admin/sign-in` and sign in; open `/listings` to inspect the seeded records. `db:seed` uses insert-if-absent records, so rerunning it does not replace an existing listing with the same slug. The commands come from [package scripts](../package.json), [migration and seed code](../src/lib/catalog-migrations.ts), and [the sample seed entry point](../scripts/seed-catalog.ts).

5. Before using public account creation or account email, set `RESEND_API_KEY` and a valid `RESEND_FROM` sender. Signup returns 503 without them. Email verification, password reset, and sign-in links depend on delivery. The app does not create new accounts through sign-in links; it sends them only to verified, active accounts. See [the account routes](../src/app/api/auth/[...all]/route.ts), [auth configuration](../src/lib/auth.ts), and [mail configuration](../src/lib/mail.ts).

## 2. Set site identity and appearance

1. Sign in as an administrator and open `/admin/branding`. Set the site name and description. Add a public image path or HTTP(S) URL for the logo, icon, and default social image, or upload a JPEG, PNG, or WebP image in the relevant slot. Uploads are limited to 5 MiB and 4096 pixels on either side; the server converts them to WebP. Save text or URL edits with **Save branding**. An uploaded slot is saved by the upload action. See [branding controls](../src/app/admin/branding/branding-editor.tsx), [input validation](../src/lib/site-config.ts), and [upload handling](../src/lib/branding.ts).

2. Open `/admin/theme` to preview and save a preset, registered theme, and public page template. The available templates are **Classic** and **Editorial**. A custom theme appears as a choice only after a developer registers it in [the theme SDK](../src/lib/theme-sdk.ts); the admin page selects installed themes, it does not create code. If a saved theme is later removed, selection falls back to the default preset and Classic template. See [theme selection](../src/lib/theme-selection.ts) and [the theme editor](../src/app/admin/theme/theme-editor.tsx).

3. Check the home, listing, and article pages in both light and dark appearance. A visitor's choice is independent of the administrator's preset mode and persists in that visitor's browser. See [appearance initialization](../src/app/layout.tsx) and [appearance control](../src/components/appearance-switch.tsx).

### Install or remove a directory add-on

Directory add-ons package themes, public page templates, public assets, and optional sample listings without replacing the starter. Use them only with a clean compatible starter checkout, and commit or back up your source before changing installed add-ons.

1. Validate a package source directory or a distributable ZIP. Validation checks manifest schema 1, the starter SemVer range, add-on API version 1, declared files, safe paths, and package integrity without changing the workspace:

   ```sh
   npm run addon:validate -- ./path/to/addon-source
   npm run addon:validate -- ./path/to/addon.zip
   ```

2. An add-on author packs a validated source directory into a deterministic ZIP, then validates the result. Equal source bytes produce an equal ZIP:

   ```sh
   npm run addon:pack -- ./path/to/addon-source ./dist/addon.zip
   npm run addon:validate -- ./dist/addon.zip
   ```

3. Install the validated archive, build the application, and inspect `/admin/theme` before selecting the new design:

   ```sh
   npm run addon:install -- ./dist/addon.zip
   npm run build
   ```

   Installation copies `src/` payload into `src/addons/<add-on-id>/`, public payload into `public/addons/<add-on-id>/`, and optional seed payload into `src/addons/<add-on-id>/seed/`. It records the package digest, contributed IDs, profile definition digests, target paths, and file hashes in `.directory-starter/addons.lock.json`, then regenerates `src/addons/generated.ts` and `src/addons/generated.css`. Do not edit the lock or generated registries by hand. A duplicate add-on, theme, template, or profile ID, a target collision, a changed installed file, incompatible package, invalid profile definition, or invalid archive is rejected before installation writes.

4. Optional catalog data is never applied during install. After the normal database migration, seed only the named installed add-on when you deliberately want its sample listings:

   ```sh
   npm run db:migrate
   npm run addon:seed -- add-on-id
   ```

   A profile-bearing seed must name the exact packaged profile ID and version. The command verifies the installed seed and schema bytes, the active immutable definition digest, every core and typed profile value, media ownership, duplicate destinations, and existing slugs before opening one transaction. A successful rerun of the same seed digest reports the existing records without inserting them again. Any conflict or invalid record rejects the whole batch. Removal does not delete records that were explicitly seeded.

5. Remove an installed add-on by ID, then build and inspect the site. Removal refuses to continue if an owned file or generated registry changed, so it does not erase local edits. A saved selection that names the removed design falls back to the preset theme and Classic template:

   ```sh
   npm run addon:remove -- add-on-id
   npm run build
   ```

   There is no in-place add-on upgrade command in schema 1. Remove an unchanged installed version, then install and validate the replacement archive. Install and remove never open or mutate the operator database. A caught command failure restores the files and lock it started with; if the process is forcibly interrupted, inspect `git status`, restore the committed starter source if needed, and rerun validation before another add-on operation.

An authoring directory contains exactly `directory-addon.json` and the files named by its `files` array. The manifest names `schemaVersion`, `id`, `name`, `version`, `compatibility.starter`, `compatibility.addonApi`, every contributed theme `{ id, name, entry }`, every template `{ id, name, stylesheet, supportedProfiles }`, every profile `{ id, version, schema }`, public `assets`, optional JSON `seed`, and the complete `files` list. Profile and field IDs use dotted namespaces; a template's `supportedProfiles` entries use a profile ID and SemVer range. Theme entries and profile schemas are under `src/`; template stylesheets are CSS files under `src/`; assets are under `public/`; and seed data is under `seed/`. Keep selectors scoped to `[data-template="your-id"]`, export a complete `ThemeDefinition` as the theme module default, and keep its runtime ID equal to the manifest theme ID. Direct edits to `src/themes/index.ts`, `src/lib/theme-selection.ts`, and `src/app/globals.css` are reserved for designs shipped as part of the starter; distributable designs use the manifest and generated registries. See the [reference manifest](../fixtures/addons/reference-addon/directory-addon.json), [manifest validator](../scripts/addons/manifest.mjs), [installer](../scripts/addons/workspace.mjs), and [generated registry builder](../scripts/addons/registry.mjs).

## 3. Configure directory profiles

A directory profile is a versioned field contract for one kind of directory. Packaged profiles come from installed add-ons; an administrator can also maintain a separate `site.local` profile for fields unique to one installation. Activation stores an immutable definition snapshot in SQLite. Listing values always name the definition version that validated them, including after their source add-on is removed.

1. Validate and install the add-on as described in section 2, run `npm run db:migrate`, sign in as an administrator, and open `/admin/profiles`. The installer validates profile paths, identity, schema, digest, starter compatibility, and template profile ranges without opening the operator database. Installation makes the packaged definition available for review; it does not activate the profile or seed data.

2. Choose a stored or installed version and select **Analyze impact**. Review the state revision, affected listings and value rows, missing required values, invalid samples, and the compatible or breaking result. Run this analysis before every first activation, version change, or switch to another profile ID. A compatible version preserves existing values under the new immutable snapshot when you select **Activate reviewed version**.

3. For a breaking change, assign every reported source field an explicit action. **Map to target field** moves values to a field in the new definition; choose whether one invalid value rejects the whole migration or is archived. **Archive retained values** removes the field from current display while retaining its versioned rows for audit. Supply defaults for new required fields before activating. Activation rechecks the state revision and performs the definition snapshot, mappings, archives, defaults, active reference, search index, and audit history in one transaction. A concurrent profile change rejects the stale request so you can analyze it again.

4. Use the site-field controls on `/admin/profiles` for installation-specific fields. Field keys stay in the `site.` namespace. Choose the type, constraints, write authority, visibility, placement, search, facet, and sort behavior deliberately. Saving a changed field creates a new immutable `site.local` version. Archiving a site field retains its old values; it does not permanently delete them.

5. The **write authority** is enforced by every listing workflow. Operator fields appear in `/admin/catalog`; owner fields appear in the owner editor; system fields are accepted only by trusted server workflows. Staff and private visibility remain out of public cards, details, facets, sorting, and search. Owner proposals retain the exact profile revision they were created against, and approval rejects stale revisions. Agent imports may stage incomplete profile values, but direct, remote, and browser-approved publication all require the active profile's required fields to validate.

6. Apply optional typed sample data only after activating the exact profile version named by the seed:

   ```sh
   npm run addon:seed -- add-on-id
   ```

   The command validates the complete batch before one transaction and records the add-on version, seed digest, profile version, and inserted count. Treat a different digest for the same installed seed provenance as a conflict to investigate. Removing the add-on later removes its source files and generated registration but leaves activated definition snapshots, current and archived values, migration history, seed provenance, and seeded listings in the database. Install the package again to make an unactivated version available; retained snapshots continue to decode existing values without it.

7. Permanent deletion is a separate administrator action. In **Permanent archived-value purge**, enter the profile ID and field key, inspect the current archived-row count, type that exact count, and select **Permanently purge**. The revision and count are checked again and the deletion is audited. Create and verify a backup first because a purge is not reversible through the profile interface.

8. Profile recovery uses the same commands as the rest of the installation. `npm run ops:backup` and `npm run ops:restore` verify definition digests, active references, typed current and archived rows, profile media ownership and files, migration references, seed provenance, and search references. An isolated restore must preserve all profile tables and media before an upgrade is attempted. Test the new code and migrations against that restore, then inspect `/admin/profiles`, public discovery, one operator listing, one owner listing, and any staged agent import. If the upgrade fails, stop it and recover from a new isolated restore of the verified pre-upgrade backup with the recorded old code and image. There is no database downgrade command.

See the [profile schema](../scripts/addons/profile-schema.mjs), [lifecycle and migration rules](../src/lib/directory-profiles.ts), [typed value codec](../src/lib/profile-values.ts), [profile administration](../src/app/admin/profiles/profile-manager.tsx), and [recovery checks](../scripts/ops-common.mjs).

## 4. Build the catalog

1. An administrator or staff member with the taxonomy capability opens `/admin/taxonomy` to add listing categories before asking owners or agents to use them. Rename a category to update its existing references. A category still used by a listing or pending draft cannot be deleted. The same workspace manages article categories and tags. See [taxonomy page access](../src/app/admin/taxonomy/page.tsx), [taxonomy controls](../src/app/admin/taxonomy/taxonomy-editor.tsx), and [taxonomy rules](../src/lib/taxonomy.ts).

2. An administrator or staff member with the catalog capability opens `/admin/catalog` to create an operator listing. Enter a lowercase hyphenated slug, name, category, public HTTP(S) destination, summary, and description. Choose **Draft** or **Published**, then save. Catalog staff can publish or unpublish an existing operator listing; **Suspend** appears only for an administrator or someone who also has the moderator capability. Slugs must be at most 80 characters; name 120, summary 280, description 5000, category 80, and URL 2048. URLs with credentials are rejected. See [catalog page access](../src/app/admin/catalog/page.tsx), [catalog form](../src/app/admin/catalog/catalog-editor.tsx), [listing validation](../src/lib/catalog-input.ts), and [catalog API](../src/app/api/admin/listings/route.ts).

3. Open `/listings` in a private browser session. Search names, summaries, and descriptions; choose a category and move between pages. Only eligible published listings appear. A listing detail page links to its destination. See [public query and featured eligibility](../src/lib/listings.ts), [index](../src/app/listings/page.tsx), and [detail page](../src/app/listings/[slug]/page.tsx).

The sample seed inserts only missing slugs. To replace samples, create your own catalog and manage publication deliberately; rerunning the seed does not erase operator content. See [sample insert behavior](../src/lib/catalog-migrations.ts).

## 5. Manage accounts, owner submissions, and review

1. To accept owners, configure Resend first, then direct them to `/owner/sign-in` to create and verify an account. The form also offers password sign-in, a verified-account email link, and password recovery. An administrator creates the initial administrator with the CLI in section 1; public signup does not grant staff roles. See [owner sign-in form](../src/app/owner/sign-in/owner-auth-form.tsx), [signup gate](../src/app/api/auth/[...all]/route.ts), and [auth configuration](../src/lib/auth.ts).

2. An owner opens `/owner/listings`, creates a private listing with an existing category, saves changes, optionally uploads an image, and selects **Submit for review**. An owner of a published listing can save a proposed revision while its current approved version remains public. A pending submission blocks further edits until review. See [owner workspace](../src/app/owner/listings/owner-editor.tsx), [submission transitions](../src/lib/moderation.ts), and [image assignment](../src/lib/media.ts).

3. A moderator opens `/admin/review`, inspects each pending proposal, and approves or rejects it with a reason. Approval publishes the proposed fields and draft image; rejection leaves a published listing's current version in place. Suspension withdraws a published listing and blocks owner edits. The owner sees the result in their workspace, and a notice is recorded for delivery. See [review controls](../src/app/admin/review/review-decision.tsx), [moderation transitions](../src/lib/moderation.ts), and [notice recording](../src/lib/notifications.ts).

4. An administrator opens `/admin/accounts` to assign any combination of moderator, editor, catalog, taxonomy, and billing capabilities to a verified, active account. Suspending an account invalidates its sessions; reinstatement is available. The final active administrator cannot be demoted or suspended. See [account controls](../src/app/admin/accounts/account-roles.tsx), [role and suspension rules](../src/lib/accounts.ts), and [capabilities](../src/lib/staff-roles.ts).

## 6. Publish articles, terms, and images

1. An administrator or staff member with the taxonomy capability creates article categories and tags in `/admin/taxonomy` before an editor uses them in an article. A term in use cannot be removed until references are changed. See [taxonomy page access](../src/app/admin/taxonomy/page.tsx) and [taxonomy rules](../src/lib/taxonomy.ts).

2. An editor opens `/admin/articles`, creates an article with a slug, title, summary, body, optional category, and existing tags. The body renders Markdown. Create a draft first when you need an image: the upload control appears after the article exists. Edit a saved article, use **Private preview**, then **Publish saved revision**. Changes to an already published article remain staged until publication. If a version conflict appears, reload the latest article before saving again. See [article controls](../src/app/admin/articles/article-editor.tsx), [revision rules](../src/lib/articles.ts), and [private preview](../src/app/admin/articles/[slug]/preview/page.tsx).

3. Owners and editors can upload JPEG, PNG, or WebP images of at most 5 MiB and 4096 pixels per side. Alt text is required. Uploads are stored in a private draft slot; approving a listing submission or publishing an article revision promotes the draft image. The public media route serves it only while the content is eligible. See [upload and visibility rules](../src/lib/media.ts), [listing approval](../src/lib/moderation.ts), [article publication](../src/lib/articles.ts), and [public media route](../src/app/media/[id]/route.ts).

4. Check `/articles`, an article detail page, and `/feed.xml` after publication. The article index supports search, category, tag, and pagination; the feed uses published articles. Withdrawing an article removes its public detail and media eligibility. See [article queries](../src/lib/articles.ts), [article index](../src/app/articles/page.tsx), and [feed route](../src/app/feed.xml/route.ts).

## 7. Configure search and sharing

1. Set `SITE_URL` to the public HTTP(S) origin before production use. It must have no path, query, fragment, or credentials. An administrator opens `/admin/seo` to set a title format containing `%s` once, default description, optional social image, and Google or Bing verification value. The workspace also displays publication-aware previews and findings; it does not predict search rank. See [origin validation](../src/lib/page-metadata.ts), [SEO page access](../src/app/admin/seo/page.tsx), [SEO settings](../src/lib/seo-settings.ts), and [findings and previews](../src/lib/seo-findings.ts).

2. Listing owners and article editors may set a search title, description, social image, and indexing preference while editing their content. Those changes remain private until the listing proposal is approved or the article revision is published. Check the published page after approval. See [draft/public overrides](../src/lib/seo-settings.ts), [listing approval](../src/lib/moderation.ts), and [article publication](../src/lib/articles.ts).

3. In `/admin/seo`, add a same-site redirect by entering an old path and new path. The server rejects loops, protected paths, and redirects that would replace a live page. The **Missing pages** list shows bounded path-only counts, without visitor query strings. See [redirect form](../src/app/admin/seo/redirect-editor.tsx), [redirect validation](../src/lib/seo-redirects.ts), and [request handling](../src/proxy.ts).

4. Inspect `/robots.txt` and `/sitemap.xml` at the public origin. A published listing or article page advertises its canonical URL and a 1200 × 630 PNG social card. Eligible detail pages also expose a Markdown route and serve Markdown for an explicit `Accept: text/markdown` request or recognized agent user agent; private and withdrawn content is excluded. Verify local output with a production build before checking live crawlers at a deployed domain. See [robots](../src/app/robots.ts), [sitemap](../src/app/sitemap.ts), [social cards](../src/lib/social-cards.ts), [Markdown routes](../src/app/markdown/listings/[slug]/route.ts), and [negotiation](../src/proxy.ts).

## 8. Import observed links with an agent

1. Sign in as an administrator or catalog staff member and open `/admin/import`. To use remote MCP, create an expiring key there, copy its secret when shown, and configure your MCP client to call the site's `/api/mcp` endpoint with `Authorization: Bearer <secret>`. **Staging only** is the default and omits `publish_import`; choose **Stage and publish** only when you intend to let that remote agent publish without another human review. Existing keys become staging-only when this scope is introduced. The key is account-bound and can be revoked on the same page. In a browser with `document.modelContext`, the authorized import page registers WebMCP tools against the current staff session; no remote key is used by that browser path. See [import page access](../src/app/admin/import/page.tsx), [key rules](../src/lib/agent-keys.ts), [remote route](../src/app/api/mcp/route.ts), and [browser registration](../src/app/admin/import/import-workspace.tsx).

2. Use `list_categories` first. Observe the destination and its source with your own browsing tool. Send 1 to 20 items to `stage_links`; each needs `idempotencyKey`, public HTTP(S) `url` and `sourceUrl`, `sourceExcerpt`, `name`, `summary`, `description`, and an existing `category`. The server validates each item and returns per-item results. It does not crawl the submitted address. Duplicate destinations and repeated keys do not create a second listing. See [tool schema](../src/app/api/mcp/route.ts) and [staging validation](../src/lib/agent-imports.ts).

   Only newly created drafts consume the staging allowance; invalid items, duplicate destinations, and idempotent retries do not. Each remote credential or browser account may create 100 newly created drafts in one UTC hour and 500 newly created drafts over that principal's lifetime. A `limited` result for the hourly allowance can be retried in the next UTC hour. At the lifetime limit, finish reviewing the existing drafts instead of retrying the same principal. An exhausted remote key can be revoked and replaced when an operator deliberately authorizes more imports. A browser account has no reset control; to continue after its lifetime limit, issue a separate expiring remote key from `/admin/import` and use remote MCP.

3. Review private drafts in `/admin/import` or through `list_imports`; treat the marked external source text as data, never instructions. You may attach a JPEG, PNG, or WebP agent-browser screenshot and preview a card. Agent screenshots must be no larger than 5 MiB and 4096 pixels on either side; the decoded source and normalized PNG must each remain within 5 MiB, and the base64 request field is capped at 7,100,000 characters. For remote MCP, `preview_card` returns a private site-relative `previewUrl`; resolve it against the site origin and fetch it with the same `Authorization: Bearer <secret>` header used for `/api/mcp`. Browser WebMCP fetches the preview through the signed-in staff session and needs no remote key. A signed-in person can publish with **Publish reviewed import**. To publish through browser WebMCP, the person first selects **Approve for browser WebMCP**; that approval records the actor, time, and current listing revision, and becomes invalid after the listing changes. A remote `publish_import` call is available only to a **Stage and publish** key. Publication records its actor and makes the listing public. Verify it at `/listings/<slug>`; failed or unreviewed imports stay private. See [import workspace](../src/app/admin/import/import-workspace.tsx), [publication transition](../src/lib/agent-imports.ts), and [card preview](../src/lib/agent-cards.ts).

## 9. Set plans and payment providers

1. An administrator or staff member with the billing capability opens `/admin/plans`. Create a free, one-time, monthly, or annual plan for either test or live mode. Enter price in minor currency units; one-time plans need a 1–3650 day duration. Choose whether the plan is enabled and whether a paid plan gets featured placement. Set `BILLING_CHECKOUT_MODE` to the mode owners should see. The same capability is required for `/admin/billing` in step 2. See [plan page access](../src/app/admin/plans/page.tsx), [billing page access](../src/app/admin/billing/page.tsx), [plan form](../src/app/admin/plans/plan-editor.tsx), and [plan validation and mode selection](../src/lib/plans.ts).

2. Before the first backup or any paid checkout, create a 32-byte base64url billing key **once** and store it outside the repository in a private file. Every installation needs this key for verified backups, even when paid billing is unused. Choose a real absolute path for `KEY_FILE`; the creation command refuses to overwrite an existing key. Put the same value in the app's `BILLING_ENCRYPTION_KEY` secret and export it for maintenance commands. Keep this file for backups and restores; regenerating it would make saved provider secrets unreadable. See [key validation and encryption](../src/lib/billing-profiles.ts) and [backup key checks](../scripts/ops-common.mjs).

   ```sh
   export KEY_FILE='/absolute/private/path/directory-billing.key'
   install -d -m 700 "$(dirname "$KEY_FILE")"
   node -e 'const fs=require("node:fs"); const crypto=require("node:crypto"); fs.writeFileSync(process.argv[1], crypto.randomBytes(32).toString("base64url") + "\n", {flag:"wx",mode:0o600})' "$KEY_FILE"
   export BILLING_ENCRYPTION_KEY="$(cat "$KEY_FILE")"
   ```

   Open `/admin/billing` and configure only the provider profiles you plan to offer; Stripe, Paddle, and NOWPayments are independently optional for each mode. To enable Stripe or Paddle, enter an API key, webhook signing secret, public key or client token, and a `plan-key=provider-price-id` mapping. NOWPayments needs an API key and webhook secret, supports only one-time plans, and needs an HTTPS public `SITE_URL`; it uses no price mapping. Stripe and Paddle can serve recurring plans. Save each selected profile and confirm it shows **Enabled**. The older `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` environment pair can serve one-time Stripe plans when no saved Stripe profile exists for that mode; mapped profiles are needed for recurring plans. See [profile form](../src/app/admin/billing/billing-editor.tsx), [profile validation and availability](../src/lib/billing-profiles.ts), and [hosted sessions](../src/lib/payment-provider.ts).

3. Route provider notifications to the application's implemented endpoints: Stripe `/api/webhooks/stripe`; Paddle `/api/webhooks/paddle/test` or `/api/webhooks/paddle/live`; NOWPayments `/api/webhooks/nowpayments/test` or `/api/webhooks/nowpayments/live`. Configure the signing secrets for the matching provider and mode. Test provider-hosted checkout in the selected test mode before enabling live plans. Provider dashboard steps and event setup must follow the provider's current instructions; this repository only defines the receiving routes and signature handling. See [Stripe webhook](../src/app/api/webhooks/stripe/route.ts), [Paddle webhook](../src/app/api/webhooks/paddle/[mode]/route.ts), and [NOWPayments webhook](../src/app/api/webhooks/nowpayments/[mode]/route.ts).

4. An owner of a published listing opens `/owner/listings/<slug>/plans` and chooses an available plan/provider. Free plans activate through the app; paid plans redirect to hosted checkout. A return to the site is not proof of payment. Signed provider events and reconciliation update purchases and time-limited featured eligibility. Owners inspect purchases and supported recurring cancellations at `/owner/billing`. See [owner plan page](../src/app/owner/listings/[slug]/plans/page.tsx), [payment effects](../src/lib/payment-lifecycle.ts), [featured query](../src/lib/listings.ts), and [owner billing](../src/lib/owner-billing.ts).

5. Handle a refund or dispute in the payment provider, then wait for its signed event or run the targeted reconciliation command in step 6 if the outcome is uncertain. The application does not initiate a refund from `/owner/billing`. For Stripe and Paddle, a **partial refund** leaves that paid period eligible while the cumulative approved refund remains below the amount paid; a **full refund**, including Paddle partial adjustments whose total reaches the amount paid, removes that period from the entitlement. NOWPayments also recognizes a fully refunded payment. An open Stripe or Paddle dispute removes the disputed period; a won or reversed dispute restores that period's eligibility only if it has not also been refunded or expired. Another valid paid period can keep the purchase's benefit active. Ask the owner to inspect `/owner/billing`: a sole fully refunded period shows **Refunded**, and a sole disputed period shows **Disputed**. For a featured plan, also check public featured placement for the published listing in the selected checkout mode; the listing can remain public without a paid featured benefit. Do not infer success from the provider dashboard action alone. See [provider outcome normalization](../src/lib/payment-normalizers.ts), [period and entitlement transitions](../src/lib/payment-lifecycle.ts), [owner-visible status](../src/lib/owner-billing.ts), and [featured eligibility](../src/lib/listings.ts).

6. Schedule `npm run billing:reconcile -- --limit 10` as a bounded maintenance job after provider setup. It retries retained verified evidence; for a specific purchase, the script also accepts `--purchase ID` and an optional `--resource PROVIDER_ID`. Limits are 1–50. Targeted NOWPayments invoice inspection additionally needs `NOWPAYMENTS_EMAIL` and `NOWPAYMENTS_PASSWORD` in the command environment. Review the JSON output and provider records when an outcome is uncertain. See [reconciliation command](../scripts/reconcile-billing.ts) and [recovery logic](../src/lib/payment-reconciliation.ts).

## 10. Deliver owner notices

Moderation and billing actions record durable notices for owners. Owners can see recent notices in their workspace even if email delivery is unavailable. To send queued email, configure the Resend sender and run a bounded worker periodically:

```sh
npm run notifications:deliver -- --limit 10
```

The limit must be 1–50. The command reports attempted, sent, and failed counts; failures retry with bounded delays and stop after five attempts. An administrator can open `/admin/notifications` to see delivery state and manually retry a failed item with no next attempt. If the outcome is marked unknown, inspect Resend before retrying to avoid a duplicate message. The retry does not repeat the moderation or payment action. See [notice storage](../src/lib/notifications.ts), [delivery and retry rules](../src/lib/notification-delivery.ts), [worker command](../scripts/deliver-notifications.ts), and [delivery workspace](../src/app/admin/notifications/page.tsx).

## 11. Deploy, back up, restore, and upgrade

### Container deployment

This Compose setup runs one application instance on one host. Install Docker Engine with Compose, then copy `.env.docker.example` to `.env.docker`. Set `SITE_URL` and `BETTER_AUTH_URL` to the public HTTPS origin and replace `BETTER_AUTH_SECRET` with a unique long random value. Set `DIRECTORY_IMAGE` to a new immutable local tag for this revision, such as `next-directory-starter:2026-10-14-abc123`; never reuse that tag for another revision. Record the tag with the deployed code revision and retain the prior tagged image through each upgrade. Keep `.env.docker` private. Set optional mail and payment variables there as described above. Before the first backup, generate the key in section 9 step 2, put it in `BILLING_ENCRYPTION_KEY`, and keep its matching file outside the repository even when paid billing is unused. Compose fixes `DATABASE_URL` to `file:/app/data/directory.db` and `MEDIA_DIR` to `/app/data/media`; both live in its named volume. It maps port 3000 to `127.0.0.1` only, so configure a reverse proxy with HTTPS at the public origin. Change `DIRECTORY_PORT` if another local service uses 3000. See the [Compose topology](../compose.yaml) and [runtime image](../Dockerfile) for the service name, image variable, loopback port, persistent volume, unprivileged runtime user, and health check.

Set a hard request-body limit at that proxy. The largest application request is the agent screenshot JSON envelope, capped at 7,100,000 bytes, so an 8 MiB proxy limit admits valid screenshots while bounding every public request before it reaches Next.js. The application trusts the proxy-owned `X-Real-IP` header for authentication rate limits, so the public Nginx edge must overwrite both client-IP headers with its connection address. Keep the Compose port bound to loopback so a public caller cannot reach the application with a forged trusted header. For Nginx, add the following to the TLS server block that owns the public hostname, replace the certificate paths and hostname, then run `sudo nginx -t` before reloading Nginx. The `8m` value is 8 MiB. Nginx answers a larger request with `413 Request Entity Too Large` without forwarding its body to the application.

```nginx
server {
    listen 443 ssl;
    server_name directory.example.com;

    ssl_certificate /etc/letsencrypt/live/directory.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/directory.example.com/privkey.pem;
    client_max_body_size 8m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
    }
}
```

From the repository root, build the image, migrate the empty database, optionally add sample listings, and start the service. Migration and seeding are explicit, not startup actions. Use the same `--env-file` and Compose project for every command so the one-off containers share the service's volume. Check `docker compose --env-file .env.docker ps` for `healthy`, then open `/listings` through the proxy.

```sh
docker compose --env-file .env.docker build
docker compose --env-file .env.docker run --rm --no-deps web npm run db:migrate
docker compose --env-file .env.docker run --rm --no-deps web npm run db:seed
docker compose --env-file .env.docker up -d --no-build
docker compose --env-file .env.docker ps
```

To create the first administrator, run the interactive provisioner. Scheduled notification and billing jobs use the same data volume and runtime settings. Arrange their schedules on the host and prevent overlapping runs of the same job.

```sh
docker compose --env-file .env.docker run --rm --no-deps web npm run account:provision -- --email you@example.com --name "Site administrator"
docker compose --env-file .env.docker run --rm --no-deps web npm run notifications:deliver -- --limit 10
docker compose --env-file .env.docker run --rm --no-deps web npm run billing:reconcile -- --limit 10
```

For a verified backup, mount a private host backup directory and the same billing key file used by the running app. This key and its matching `BILLING_ENCRYPTION_KEY` value are mandatory for every backup, including free-only installations with no provider profile. Set `BACKUP_DIR` and `KEY_FILE` to real absolute host paths that container user ID 1000 can access; the backup directory must be writable by that user. The destination must be new. An isolated restore verifies the archive into another new directory on that host mount; it does not overwrite the live volume.

```sh
export BACKUP_DIR=/private/backups
export KEY_FILE=/private/keys/directory-billing.key
docker compose --env-file .env.docker run --rm --no-deps \
  -v "$BACKUP_DIR:/backup" -v "$KEY_FILE:/run/secrets/billing.key:ro" \
  web npm run ops:backup -- --output /backup/directory-YYYYMMDD --key-file /run/secrets/billing.key
docker compose --env-file .env.docker run --rm --no-deps \
  -v "$BACKUP_DIR:/backup" web npm run ops:restore -- \
  --backup /backup/directory-YYYYMMDD --target /backup/directory-restore-check
```

Before an upgrade, verify a backup and isolated restore, record the currently deployed `DIRECTORY_IMAGE`, set a fresh immutable tag for the new revision in `.env.docker`, build the new revision, stop the service, run its migration, and start it. Keep the prior tagged image and backup until you inspect public and authorized paths. Do not run two application containers against the same SQLite volume.

To recover from a failed upgrade, stop the service, check out the old code, and use a **new** Compose project with the recorded prior image tag. Set `RECOVERY_IMAGE` to that exact tag and make `docker image inspect` succeed before touching the recovery volume. The `DIRECTORY_IMAGE="$RECOVERY_IMAGE"` prefix overrides the failed revision's value in `.env.docker`; use it on every `directory-recovery` command. The following one-off command copies the verified restore into that project's empty volume. The host restore directory must be readable by container user ID 1000. Keep `BILLING_ENCRYPTION_KEY` in `.env.docker` equal to the restored `billing.key` value. Run all later Compose commands with `-p directory-recovery` to keep using this new volume. Start only after the original service has stopped, since both projects bind the same local port.

```sh
export RECOVERY_IMAGE='next-directory-starter:2026-10-01-abc123'
docker image inspect "$RECOVERY_IMAGE"
docker compose --env-file .env.docker down
DIRECTORY_IMAGE="$RECOVERY_IMAGE" docker compose --env-file .env.docker -p directory-recovery run --rm --no-deps \
  -v "$BACKUP_DIR:/backup:ro" web sh -eu -c '
    test ! -e /app/data/directory.db
    cp /backup/directory-restore-check/database.db /app/data/directory.db
    mkdir -p /app/data/media
    cp -a /backup/directory-restore-check/media/. /app/data/media/
  '
DIRECTORY_IMAGE="$RECOVERY_IMAGE" docker compose --env-file .env.docker -p directory-recovery up -d --no-build
```

Inspect public and authorized paths before routing traffic to the recovered service. The restore command intentionally never modifies the original volume; preserve it until recovery is verified. See the [backup](../scripts/backup.mjs) and [restore](../scripts/restore.mjs) scripts for their exact checks.

### Production checklist

- Install the locked packages with `npm ci`; run `npm run build`, `npm run db:migrate`, and `npm run start` with the same database environment. The [package scripts](../package.json) define these commands.
- Set `SITE_URL` and `BETTER_AUTH_URL` to the public origin. Set a unique `BETTER_AUTH_SECRET`. Use a persistent `file:` SQLite path and a persistent writable media directory. Both must survive builds and restarts. See [origin validation](../src/lib/page-metadata.ts), [database connection](../src/lib/database.ts), and [media directory](../src/lib/media.ts).
- Keep the app and shell jobs on the same persistent `DATABASE_URL` and `MEDIA_DIR`. Repository commands run from the project root load `.env.local`; explicit process environment values take precedence. If a scheduler uses another working directory, configure its environment explicitly and check the selected storage path. Create and retain `BILLING_ENCRYPTION_KEY` before the first backup even when billing is unused; changing it later also makes any saved provider secrets unreadable. See [CLI environment loading](../scripts/load-env.mjs), [operations environment reader](../scripts/ops-common.mjs), and [secret decryption](../src/lib/billing-profiles.ts).
- Configure Resend, paid providers, and their scheduled jobs only when those features are needed. Verify public pages, media, robots, sitemap, and a signed test-mode payment before taking live payments.

### Create a verified backup

The backup command reads `DATABASE_URL`, optional `MEDIA_DIR`, and `BILLING_ENCRYPTION_KEY` from its process environment or the project's `.env.local`. It always requires a private regular file containing **that same** 32-byte base64url key, whether or not a billing profile exists. The destination must not already exist or overlap the live database or media. Keep the resulting directory private: it contains the database, media, and billing key.

```sh
npm run ops:backup -- --output /private/backups/directory-YYYYMMDD --key-file /private/keys/directory-billing.key
```

The script uses SQLite's backup operation, copies media, checks database integrity and decryptability, validates every directory-profile definition and reference, hashes files, writes `manifest.json`, and prints `Backup created and verified.` only after success. A profile check covers active state, typed current and archived values, media ownership, migration history, seed provenance, and search rows. See [backup implementation](../scripts/backup.mjs) and [integrity checks](../scripts/ops-common.mjs).

### Verify an isolated restore

Use a new target directory outside the backup and live storage trees:

```sh
npm run ops:restore -- --backup /private/backups/directory-YYYYMMDD --target /private/restores/directory-check
```

Restore verifies the manifest hashes, SQLite integrity, referenced media files, billing key, and directory-profile invariants before creating the target, then validates the copied target again. It refuses an existing or overlapping target and prints `Isolated restore verified.` on success. The target contains `database.db`, `media/`, and `billing.key`. To use it, stop the installation and point `DATABASE_URL`, `MEDIA_DIR`, and `BILLING_ENCRYPTION_KEY` at those restored values through your deployment's secret manager. Never copy a restored database over a running one. See [restore implementation](../scripts/restore.mjs) and [path checks](../scripts/ops-common.mjs).

### Upgrade and recover

1. Preserve the current code revision and lockfile. Create and verify a backup as above **before** running migrations or a new build against operator data.
2. Test the new revision against an isolated restore, with its own `DATABASE_URL`, `MEDIA_DIR`, and billing key. Run `npm ci`, `npm run db:migrate`, and `npm run build`; inspect public and authorized workflows there. When profiles are active, inspect `/admin/profiles`, public profile fields and discovery controls, current and archived listing values, profile media, and one migration-history path before touching live storage. The [migration functions](../src/lib/catalog-migrations.ts) track applied versions and the [package scripts](../package.json) define the commands.
3. Stop the live process. Deploy the tested revision, run its migration against the intended persistent database, then start and inspect the site. Keep shell and app database environments aligned.
4. If the new revision fails, stop it. Restore the old code and lockfile, make a **new isolated restore** from the pre-upgrade backup, and point the old installation at the restored database, media, and matching key. There is no database downgrade command in [package scripts](../package.json); rollback uses the verified restore path.

Do not treat a successful backup file alone as proof of recovery. Verify an isolated restore before relying on it.
