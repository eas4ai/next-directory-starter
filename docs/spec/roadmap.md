# Roadmap

Current: operator-adoption

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
