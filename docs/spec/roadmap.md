# Roadmap

Current: import-screenshot-after-publish

## public-starter-and-theme

Requirements: FOUND-001, DIR-001, DIR-002, SEO-001, SEO-002, ADM-004, ADM-005, ADM-006, ADM-007

Delivery: create the current stable Next.js App Router application with
TypeScript, React, and shadcn/ui. Add a small, replaceable sample listing set
to support the public directory index and detail routes. Render the directory
and listing content on the server. Give each route its own title, description,
canonical URL, and social metadata. The mechanisms exercise a fresh build and
fetch initial HTML for the public routes using the sample data. Add an
documented first-administrator provisioning and sign-in, a protected theme editor with the complete pinned
shadcn/ui preset controls and a preview, and persistent site-wide theme
settings. The admin-theme mechanism checks authorization, each control's
options, saving, and the rendered theme after restart.

Done-when: a fresh install builds; an HTTP request without JavaScript sees an
eligible listing on the directory page and its full detail and external link
on its own page; the initial HTML carries the matching page metadata; and an
authenticated administrator can preview and save any supported preset while
other accounts cannot change it, with the saved theme surviving a restart.

## operator-catalog

Requirements: FOUND-002, FOUND-003, FOUND-004, DIR-003, DIR-004

Delivery: replace the source-file sample catalog with migrated SQLite tables
for listings and categories. Provide repeatable sample seeding, documented
first-run and migration commands, documented site identity settings, and
authenticated operator controls for listings. The public directory reads eligible rows
from the database, supports query and category filters with bounded pages, and
reflects publication changes on the index and detail routes. Preserve the
existing theme editor and server-rendered public pages.

Done-when: a fresh database migrates and seeds a browsable directory; an
operator changes the site's identity and sees it in the header and metadata;
operator-created listings survive restart; search and category
filters return only matching eligible listings within the documented page
bound; and a newly ineligible listing disappears from every public directory
route, including its former detail URL.

## owner-moderation

Requirements: PUB-001, PUB-002, PUB-003, PUB-004, PUB-005, ADM-003

Delivery: extend the migrated catalog with owner identity, private drafts,
submissions, and review history. Give signed-in owners a listing workspace that
allows editing only their own content. Let authorized moderators review,
approve, reject with a reason, and immediately suspend published listings.
Keep an approved version public while an owner's proposed changes await a
decision. Give administrators a view of pending submissions and prior reviews.
Preserve the existing operator catalog and public eligibility rules.

Done-when: two owner accounts cannot read or edit each other's private work;
a submitted draft enters a private review queue; a moderator's rejection and
reason are visible in review history; approval publishes the reviewed version;
the prior approved version remains public during a proposed revision; and a
suspended listing disappears from public search and its detail URL at once.

## editorial-publishing

Requirements: EDIT-001, EDIT-002, EDIT-003

Delivery: add a migrated article and tag model, an editor role, and protected
article and taxonomy controls. Let an authorized editor save, publish, and
unpublish articles. Serve published articles on public index and detail routes.
Let an operator add listing categories and article tags through administration,
and make new categories available in directory navigation. Expose a feed that
contains published articles only. Preserve owner moderation and the existing
public directory.

Done-when: an editor can save a draft that returns a missing response on public
routes, publish it to a reachable article page, and unpublish it again; a
non-editor cannot make the same changes by direct request; an operator can add
a category and a tag without code edits and see the category in directory
navigation; and the feed contains every published article in the test set and
no draft or unpublished article.

## public-crawl-and-responsive

Requirements: SEO-003, SEO-004, SEO-005, DIR-005

Delivery: generate a request-current sitemap and robots policy for eligible
public pages. Keep missing and ineligible content at a missing HTTP response,
and mark filtered or paginated result variants so crawlers do not index them as
canonical pages. Add structured data whose identity, links, and descriptions
match the visible public content. Verify public directory and detail layouts at
320 pixels in light and dark modes, preserving the 1400-pixel maximum width on
larger screens.

Done-when: a published listing and article appear in the sitemap while drafts,
suspended listings, and private routes do not; changing eligibility updates
the sitemap; robots points to that sitemap and excludes private routes; missing
content returns 404; query-result variants are nonindexable; structured data
matches the rendered page; and directory index and detail pages remain readable
without horizontal scrolling at 320 pixels in light and dark modes.

## commerce-and-governance

Requirements: COM-001, COM-002, COM-003, ADM-001, ADM-002

Delivery: add migrated publishing plans with price, currency, duration, and
placement terms. Show an approved listing's owner those terms before starting
one-time Stripe-hosted Checkout. Keep the selected terms with the purchase;
only verified, matching payment events may grant or revoke an entitlement,
and repeated events must have no additional effect. Show currently entitled
featured listings in a labelled section separate from ordinary results,
without changing the ordinary order. Give administrators controls for plans
and account roles, enforce permissions on direct requests across existing
review, editorial, commerce, and site configuration actions, and record the
actor and time for moderation, publication, plan-setting, and role changes.
Store provider credentials outside the database and source tree.

Done-when: a plan's price and publication duration are visible to the owner
before checkout; an unsigned or mismatched event cannot activate a listing;
a verified event grants one entitlement despite replay, while a verified
reversal or expiry ends it; a current featured entitlement has a visible
label and separate placement but does not reorder normal search results;
unauthorized direct requests cannot change protected state; and the audit
history identifies the actor and time of each named protected action.

## account-access

Requirements: ACC-001, ACC-002, ACC-003, ACC-004

Delivery: connect Better Auth to the documented Resend email service, require email
verification for public accounts, add password recovery and passwordless
magic-link sign-in for existing verified accounts, and preserve host
administrator provisioning. Add audited account suspension and reinstatement
that revokes sessions and removes suspended owners' listings from public
surfaces. Update the sign-in and account-management pages and the existing
workflow checks for the verified-account journey.

Done-when: a fresh account cannot use protected routes before following its
verification email; the first administrator can still sign in; a password
reset invalidates the prior password and sessions; a verified account can
use one magic link exactly once; an unknown address cannot sign up through
magic link; and suspending an account immediately blocks its sessions and
hides its listings until reinstatement, without suspending the final active
administrator.

## payment-foundation

Requirements: COM-004, COM-005

Delivery: extend migrated plans to free, one-time, monthly, and annual terms
without changing existing paid purchases. Keep approval's current free ordinary
publication path. Let an administrator configure separate disabled-by-default
test and live profiles for Stripe, Paddle, and NOWPayments, with protected
write-only secrets encrypted under an operator key and mode-specific price
mappings for Stripe and Paddle. Show owners the applicable plan terms; keep
new recurring and provider checkout unavailable until the later payment
lifecycle commitment connects them. Preserve current Stripe one-time checkout
for previously configured installations.

Done-when: the operator can create and edit each plan mode through protected
controls; a new approved listing remains ordinarily public without payment;
free selection creates no provider charge; existing purchases keep their
original amount, currency, duration, and featured terms after plan edits; an
unauthorized request cannot read or change provider settings; database rows and
responses do not expose saved secrets; test and live credentials and mappings
remain separate after restart; and a disabled or incomplete profile is not
offered as a new provider checkout option.

## payment-lifecycle

Requirements: COM-006, COM-007, COM-008, COM-009

Delivery: connect eligible one-time and recurring plans to hosted Stripe and
Paddle checkout, and one-time plans to the official NOWPayments Node SDK.
Reserve immutable purchase terms and provider/mode identity before calling an
external service; an ambiguous response remains one recoverable pending
purchase. Verify and retain signed provider events before changing access.
Process paid periods, scheduled cancellation, full and partial refunds,
disputes, and expiry without bypassing listing moderation or making test-mode
payments publicly eligible. Show owners the status of their purchases and
supported cancellation action. Add bounded operator reconciliation that can
retry retained evidence or read an existing provider resource without creating
a charge. Preserve free publication and existing Stripe one-time purchases.

Done-when: each enabled provider offers only supported plans in its selected
mode; approved owners can start hosted checkout from the server's price and
cannot create a second payable attempt on retry; unsigned, unmatched, partial,
or unsettled events grant nothing while a matching settled event grants once;
verified renewal, cancellation, full refund, partial refund, dispute, and
expiry produce the specified access state; and owners and operators can inspect
and recover pending purchases without creating another payment.

## content-and-notifications

Requirements: MED-001, MED-002, EDIT-004, EDIT-005, NOTIFY-001, NOTIFY-002

Delivery: add a private local image store with bounded decoding, re-encoding,
alt text, and authorization for listing drafts and editorial articles. Serve
images publicly only with the approved listing or published article that owns
them. Render safe Markdown for listing descriptions and article bodies, with a
private editorial preview and explicit publication of saved revisions. Add
published-only article search, pagination, article categories, and tag
navigation. Record moderation and verified payment notices atomically and show
an owner's latest 20 in their workspace. Deliver retained notices through
Resend in bounded batches with retries and visible failures.

Done-when: a wrong owner or guest cannot upload or read private media; unsafe or
oversized images are rejected; pending revisions keep their prior approved
image, and suspension or unpublication removes public media immediately;
Markdown cannot run active content; a saved article revision stays private
until explicit publication and stale saves are refused; public article filters
exclude drafts and stay bounded; each named state change produces one private
notice despite replay; and a failed Resend delivery remains retryable after
restart without repeating the underlying domain action.

## seo-operations

Requirements: SEO-006, SEO-007, SEO-008, SEO-009, SEO-010

Delivery: add administrator-controlled site metadata and verification values,
and revision-bound search/social overrides for listings and articles. Apply
current public eligibility and indexability to initial HTML, structured data,
sitemap and robots output. Add bounded same-site redirects, old article slug
aliases, and a path-only missing-page report. Show current SEO findings and
search/social previews to authorized administrators. Serve Markdown versions of
eligible listings and articles with matching public content and explicit
nonindexable, noncached responses. Preserve existing public routes and the
shadcn/ui visual system.

Done-when: unpublished changes do not alter public search metadata; overrides
and verification values appear only where authorized and eligible; sitemap,
robots, canonical, social and structured output agree with public content;
unsafe redirects and query-bearing 404 records are rejected; old published
article slugs redirect safely; an administrator sees reproducible findings and
accurate previews; and Markdown versions track publication and eligibility on
every request without exposing private revisions.

## operator-adoption

Requirements: ADM-008, ADM-009, UI-001, FOUND-005, OPS-001, OPS-002

Delivery: add a truthful staff overview with publication counts, review work,
bounded audit activity, and capability-aware navigation. Let an administrator
combine predefined staff capabilities on verified accounts while preserving
existing administrator, moderator, editor, account suspension, and theme
behavior. Give each visitor a saved light or dark choice that overrides only
the operator's preset mode. Include the selected MIT license and required
notices. Provide tested backup, isolated restore, and upgrade guidance for
the SQLite database, media, and billing encryption key.

Done-when: overview counts match current eligible content and pending review
records, with no protected data or actions exposed to the wrong role; direct
requests follow the same capability matrix as navigation and retain the final
administrator; two visitors can keep different readable appearances across
reload and initial HTML; the distribution carries the correct MIT notice;
and a disposable installation can follow the documented backup, restore, and
upgrade path without losing content, media, or encrypted settings.

## agent-ingestion

Requirements: ING-001, ING-002, ING-003, ING-004

Delivery: add account-bound remote MCP access for Claude Code and WebMCP tools
on the authenticated catalog import page. Reuse catalog permissions and
operator-managed draft and publication behavior. Accept bounded crawl evidence
for a single URL, directory page, or link list from agent-browser rather than
fetching submitted URLs on the server. Stage idempotent per-link results with
provenance and preview; publish only by an explicit authorized action. Generate
branded social cards from the staged content and optional validated screenshots.
Expose public cards only for eligible published listings and connect them to
Open Graph and Twitter metadata while preserving custom overrides.
Document Claude Code and agent-browser workflows for single URLs, directory
pages, and an awesome list.

Done-when: a verified administrator and a catalog staff member can connect and
stage multiple observed links; ordinary owners, guests, revoked credentials,
and suspended accounts cannot; invalid and duplicate links return bounded
individual results; a retry creates no extra record; staging leaves public
pages unchanged until explicit publication; a published import is visible with
the reviewed text and an audited actor; and its valid social card appears in
public metadata while draft or suspended cards do not.

## theme-sdk

Requirements: THM-001, THM-002, THM-003, THM-004

Delivery: provide a typed token SDK for custom themes, a stylesheet-based
rendering path, and registered public layout templates. Preserve every pinned
shadcn/ui preset choice and the visitor's independent appearance mode. Add
protected preview and selection for installed themes and templates, plus
protected brand settings for site identity, logo, favicon, and default social
card with validated image uploads. Connect generated listing cards to the
selected brand and theme while preserving explicit social-image overrides.
Ship a repository skill that guides an agent through creating a custom theme,
template, and brand kit, with working examples and documented checks.

Done-when: a new theme and template can be created through the documented SDK
without editing application page components or adding authored inline CSS; an
administrator can preview and save them, reload after restart, and see the
chosen design on public and admin surfaces in light and dark mode; the
branding controls change the header, favicon, fallback social metadata, and
generated listing cards, preserve explicit social images, reject unsafe
uploads, and survive backup and restore; public content, metadata, access,
and 320-pixel readability remain correct.

## next-geo

Requirements: SEO-011

Delivery: recognize Markdown requests for eligible public listing and article
detail pages through the existing Next.js proxy. Serve the current public
revision from the existing Markdown routes for explicit `Accept` headers,
documented agent user agents, and `.md` URLs. Keep ordinary HTML responses and
private routes on their current path. Apply nonindexable, noncached Markdown
headers and representation-aware `Vary` headers without broad HTML conversion.

Done-when: each supported request signal returns the same current Markdown as
the linked route; HTML requests remain HTML; private and ineligible content
cannot be converted or exposed; staged revisions stay private; and responses
carry the specified content type, crawl, cache, and variation headers.

## next-geo-cache-policy

Requirements: SEO-011

Delivery: finish the eligible-detail Markdown negotiation from next-geo. Keep
both representations noncached. Require `Vary: Accept, User-Agent` on Markdown;
Next.js 16 currently replaces the corresponding HTML header after rendering.
Retain all publication, revision, private-route, and explicit Markdown rules.

Done-when: the production HTTP check passes all SEO-011 request signals and
withdrawal cases; HTML detail responses remain noncached and Markdown has the
required variation, crawl, and cache headers.

## social-cards

Requirements: SEO-012

Delivery: serve one 1200-by-630 PNG card for each shareable public home, index,
listing, and article page. Generate a branded card on a fresh installation,
fit current published image sources without distortion, safely normalize
external image URLs, and expose the same card through Open Graph and X metadata
with real dimensions. Preserve the existing publication, override, and preview
rules.

Done-when: a production HTTP check reads the initial HTML as Facebook and X
crawlers, fetches each advertised image, verifies a 1200-by-630 PNG and matching
tags, and proves current public overrides, withdrawal, fallback, and private
network boundaries. Live platform checks follow once the starter has a public
domain.

## readme-overview

Requirements: DOC-001

Delivery: replace the procedure-heavy README with a source-verified feature
overview, a short first-run path, and realistic site ideas grounded in the
listing and article model. Save a source-linked brief for the separate operator
manual requested next.

Done-when: the README covers each implemented product area and its conditional
dependencies accurately, gives only source-supported site examples, and keeps
long operating procedures in the future manual's scope. A check compares the
README and manual brief with implementation paths and package scripts; the
builder's review audits every material claim against source.

## operator-manual

Requirements: DOC-002

Delivery: write `docs/operator-manual.md` with executable, source-verified
operator steps for the ten areas in the manual brief. Link it from the README.
Describe the confirmed `.env.local`/CLI database-path mismatch and the current
same-environment workaround while its product fix waits in the backlog.

Done-when: each procedure is grounded in implementation code or an executable
script, names its actor and success check, and makes external-provider and
persistent-storage dependencies explicit. A mechanism checks chapter coverage,
source links, commands and high-risk boundaries; the builder and adversary
review the remaining semantic claims against source.

## cli-env-local-mismatch

Requirements: FOUND-006

Delivery: make the repository's migration, seed, and maintenance entry points
read the same `DATABASE_URL` selection that the app and Better Auth read. Keep
an explicit process environment override. Update the operator manual's custom
SQLite guidance to reflect the fix.

Done-when: an isolated install with a custom database path only in `.env.local`
migrates authentication and catalog tables, seeds listings, and runs its
maintenance commands against that one file without creating the default file;
an explicit process environment path overrides the local file; the manual
matches the verified behavior.

## container-deployment

Requirements: OPS-003

Delivery: add a multi-stage Dockerfile, a secret-excluding build context, and a
single-host Compose service with a persistent SQLite and media volume. Keep
runtime configuration outside the image and expose a local port for an operator
reverse proxy. Document first start, explicit migrations and optional seed,
scheduled jobs, backup, restore, and upgrade commands for that container.

Done-when: a clean image build and isolated Compose run serve the public
directory; migration, seed, and maintenance commands share its database; a
container replacement preserves content and media; the container is non-root;
and the image contains neither deployment secrets nor operator data.

## test-suite-regressions

Requirements: FOUND-007

Delivery: add a single repository test command that runs all Node tests without
allowing the production-build tests to contend for `.next`. Correct the legacy
plan migration fixture to include its declared prior schema, and align the
content HTTP test with the current staff role permissions. Keep the production
permission and migration behavior intact.

Done-when: the command covers every `tests/*.test.mjs` file and completes with
no failures; the isolated legacy-plan fixture migrates with valid foreign keys;
and the content HTTP checks enforce the current editor and taxonomy boundaries.

## preset-font-render-blocking

Requirements: THM-005

Delivery: replace the external font stylesheet import in the runtime theme CSS
with font loading that leaves the initial render unblocked. Keep every preset
body and heading font choice, saved selections, previews, and registered custom
theme typography working across public and admin pages.

Done-when: production page checks on the home, listing, and admin surfaces show
no render-blocking external font stylesheet; each preset font resolves for body
and heading selections with visible fallback text during loading; saved choices
survive navigation and restart; and a custom theme retains its declared fonts.

## readme-social-card

Requirements: DOC-001

Delivery: place the developer-provided `assets/social-card.jpg` immediately below
the README title with descriptive alternative text. Keep the source-verified
overview and first-run instructions intact.

Done-when: the README renders the committed JPEG at the top through a relative
path, and the DOC-001 overview check still passes.

## intermittent-turbopack-build-crash

Requirements: FOUND-001

Delivery: reproduce the intermittent production-build crash from a clean
workspace, then make the documented default build reliable. Compare the
supported Next.js build paths, including the proposed Rspack integration,
without losing the current Tailwind CSS output or public routes.

Done-when: repeated clean default builds succeed, the produced CSS and route
set match the expected application, and the documented build command uses the
verified stable path.

## legacy-stripe-checkout-path

Requirements: COM-008

Delivers backlog item legacy-stripe-checkout-path: Audit 2026-10-11 (H1, OPS-6). POST /api/owner/listings/[slug]/checkout is still live although the UI uses hosted-checkout. Its purchases have no provider_resource_id or payment_periods row, so Stripe events go to processStripeEvent (src/lib/payment-events.ts:88), which handles only checkout success and charge.refunded and records charge.dispute.* as processed without effect. An owner can pay through the legacy route, file a chargeback, and keep featured placement for the paid period. Migrated legacy purchases also cannot be reconciled: version 9 added provider_resource_id without a backfill, and recovery rejects resource-less paid purchases even with --resource cs_... (src/lib/payment-reconciliation.ts:233). Disable the legacy route and move legacy purchases onto the payment lifecycle without granting a second period, or add dispute handling and a legacy recovery path.

## listing-edit-reverses-suspension

Requirements: PUB-005

Delivers backlog item listing-edit-reverses-suspension: Audit 2026-10-11 (H2, verified). PATCH /api/admin/listings/[slug] reads the listing at line 13, then awaits the body, then checks the moderation rule against that stale status at line 28. updateListing (src/lib/listings.ts) overwrites status without rechecking, and the body is merged as {...existing, ...changes}, so a body without status writes the old status back. A catalog-only user's routine edit that overlaps a moderator's suspension republishes the listing; a slow body widens the window. Recheck current status and the actor's moderation permission inside the immediate transaction and reject stale writes with an expected revision.

## admin-actor-not-rechecked

Requirements: ADM-001

Delivers backlog item admin-actor-not-rechecked: Audit 2026-10-11 (M2, verified code path). Account role and suspension routes check canAdmin before awaiting the body and params; changeAccountRole and changeAccountSuspension (src/lib/accounts.ts) recheck the target and last-admin rule but not the actor. An admin who is demoted or suspended while holding a request open can still restore their own role or reinstate themselves. Re-read the actor inside the same immediate transaction and require a verified, unbanned administrator.

## rss-cursor-blocks-writes

Requirements: EDIT-003

Delivers backlog item rss-cursor-blocks-writes: Audit 2026-10-11 (M1, reproduced). /feed.xml streams rows from publishedArticleFeedRows, a live better-sqlite3 iterator on the shared connection kept open across stream pulls. While an iterator is open every write on that connection throws 'This database connection is busy executing a query' (reads still work). A slow anonymous reader of a feed larger than socket and Next.js buffers blocks publication, sessions, audit and notification writes for the whole process. Read bounded rows with .all() before streaming, or use a separate read-only connection.

## media-orphaned-files

Requirements: MED-001

Delivers backlog item media-orphaned-files: Audit 2026-10-11 (M3, verified). uploadPrivateImage (src/lib/media.ts) writes a new UUID file and media_assets row per upload and moves the draft assignment; superseded files and rows are never removed (unlinkSync runs only on a failed transaction). Branding replacement (src/lib/branding.ts:75) does the same. A verified owner re-uploading in a loop fills the volume that also holds SQLite. Reclaim unreferenced superseded assets inside the reassignment transaction and add a per-account upload quota or rate limit.

## restore-symlink-isolation

Requirements: OPS-001

Delivers backlog item restore-symlink-isolation: Audit 2026-10-11 (M4, reproduced). scripts/restore.mjs hashes and inspects database.db through symlinks, and cpSync keeps symlinks by default; regularFiles checks links inside media/ but not the media root. A tampered or hand-built backup with database.db pointing at the live database passes every check, and the restored copy then writes to live storage. lstat the database, key and media root and require a regular file or real directory; reject any symlink in the staged copy before renaming it into place.

## recovered-invoice-missing-charge-id

Requirements: COM-008

Delivers backlog item recovered-invoice-missing-charge-id: Audit 2026-10-11 (M5, verified in reconciliation code). Recovered Stripe invoice evidence (src/lib/payment-reconciliation.ts:115) stores paymentId as the invoice id (in_*) with no charge or payment-intent id. matchingPeriod (src/lib/payment-lifecycle.ts:207) matches outcomes by payment or charge id, so later refunds or disputes against pi_* or ch_* match nothing and placement stays active. Store the payment-intent and charge ids on recovered evidence and let a duplicate paid-period event fill a missing association.

## article-status-publish-skips-version

Requirements: EDIT-001

Delivers backlog item article-status-publish-skips-version: Audit 2026-10-11 (M6, verified code path). A status-only PATCH to /api/admin/articles/[slug] ({"status":"published"}) calls updateArticle, which publishes the current stored draft without the version check publishArticleRevision uses. Editor A can publish editor B's newer unreviewed text; a stale withdrawal can discard newer staged work. Require a version for every publish and withdraw transition and route them through the revision-aware functions.

## submission-approval-overwrites-changes

Requirements: PUB-004

Delivers backlog item submission-approval-overwrites-changes: Audit 2026-10-11 (M7, reviewer reproduced in memory). Approval (src/lib/moderation.ts:228) replaces the listing with the submission payload and sets published without comparing the listing's current revision to the submission's base. If an admin corrects and withdraws a listing after an owner submits, approving the old submission loses the correction and republishes the listing. Bind submissions to a listing revision and reject or invalidate them after intervening changes.

## import-screenshot-after-publish

Requirements: ING-004

Delivers backlog item import-screenshot-after-publish: Audit 2026-10-11 (M8, verified). attach_screenshot updates agent_imports only WHERE published_at IS NULL (src/lib/agent-imports.ts:170), but publishing through the catalog PATCH route changes listings.status without setting published_at. After that publication an agent can still replace the screenshot and change the public card. Check the real listing status in the screenshot update and set published_at on every publication path.
