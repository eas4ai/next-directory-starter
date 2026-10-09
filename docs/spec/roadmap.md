# Roadmap

Current: operator-catalog

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
