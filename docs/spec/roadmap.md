# Roadmap

Current: public-starter-and-theme

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
