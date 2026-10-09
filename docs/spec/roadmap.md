# Roadmap

Current: editorial-publishing

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
