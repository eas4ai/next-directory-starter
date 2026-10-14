# Editorial

Prefix: EDIT

[EDIT-001] An authorized editor can draft, publish, and unpublish articles without exposing drafts on public routes.
Falsifier: An article draft is publicly reachable, or a published article has no public page.
Mechanism: editorial-articles
Status: Agreed 2026-10-09

[EDIT-002] The operator manages listing categories and article tags without editing source code.
Falsifier: Adding a category through administration requires a code change or fails to appear in directory navigation.
Mechanism: editorial-taxonomy
Status: Agreed 2026-10-09

[EDIT-003] The application offers a feed of published articles only.
Falsifier: The feed includes a draft or omits a published article.
Mechanism: editorial-feed
Status: Agreed 2026-10-09

[EDIT-004] Listing descriptions and article bodies render safe Markdown in public HTML. An editor can preview a private article revision, save changes to a published article without changing its public version, and explicitly publish that saved revision; a stale save cannot overwrite a newer revision.
Falsifier: Raw HTML or an executable link runs in a public page or preview, a guest opens a draft preview, an unsaved or merely saved article edit changes the public body, or a stale editor replaces newer work.
Mechanism: content-notifications
Status: Agreed 2026-10-09

[EDIT-005] Visitors can search and page through published articles and navigate article categories and tags. Authorized editors can manage article categories separately from listing categories without orphaning articles that use them.
Falsifier: A draft appears in search or a term page, query or term filters are ignored, pages are unbounded or repeat records, or removing an in-use article category leaves a broken article.
Mechanism: content-notifications
Status: Agreed 2026-10-09
