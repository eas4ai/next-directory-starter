# SEO

Prefix: SEO

[SEO-001] The application includes public directory and listing content in server-produced HTML on an initial request without requiring browser JavaScript.
Falsifier: Fetching the directory or an eligible listing with an HTTP client returns only a loading shell and no listing text.
Mechanism: public-seo
Status: Agreed 2026-10-09

[SEO-002] The application emits page-specific title, description, canonical URL, and social metadata for every public directory and listing page.
Falsifier: Two different listing pages share the same canonical URL, or a listing page has no title or description in its initial HTML.
Mechanism: public-seo
Status: Agreed 2026-10-09

[SEO-003] The application generates a sitemap and robots policy that expose eligible public pages and exclude private or ineligible content.
Falsifier: The sitemap includes an unpublished listing or omits a published one.
Mechanism: seo-crawling
Status: Agreed 2026-10-09

[SEO-004] The application gives missing and ineligible content a proper missing response and prevents query-result variants from being indexed as canonical pages.
Falsifier: A missing listing answers 200, or a search-query URL declares itself as a crawlable canonical page.
Mechanism: seo-indexing
Status: Agreed 2026-10-09

[SEO-005] The application emits structured data matching each public page's visible content.
Falsifier: A listing page's structured title or destination describes a different listing.
Mechanism: seo-structured-data
Status: Agreed 2026-10-09

[SEO-006] An administrator can manage site search defaults and Google/Bing verification values. Authorized listing owners and article editors can save optional search title, description, social image and indexability overrides for their content; a pending revision cannot alter the public metadata until approval or publication.
Falsifier: A guest or wrong owner reads protected settings or changes an override; a saved but unapproved edit changes public metadata; or an empty override fails to use the content default.
Mechanism: seo-operations
Status: Agreed 2026-10-10

[SEO-007] Public HTML, structured data, robots policy and sitemap derive from the same current eligible revision and configured site origin. Search and social metadata honor published overrides and indexability, while query variants keep a documented canonical and noindex policy.
Falsifier: A noindex or suspended record appears in the sitemap, metadata uses the request Host instead of SITE_URL, a draft override leaks into initial HTML or structured data, or a filtered result declares itself an indexable canonical page.
Mechanism: seo-operations
Status: Agreed 2026-10-10

[SEO-008] An administrator can add bounded same-site permanent redirects and inspect a bounded path-only 404 report. Redirects cannot target external sites, form cycles, shadow live routes, or expose query credentials in the report; a published article slug change retains an old-slug redirect.
Falsifier: A cross-site destination, redirect loop or live-route collision is accepted; an old published article slug returns 404 after a legitimate rename; or a missing URL records or displays a token-bearing query.
Mechanism: seo-operations
Status: Agreed 2026-10-10

[SEO-009] An authorized administrator can inspect actionable SEO findings and search/social previews computed from current public content and settings, without a fabricated ranking score.
Falsifier: A missing or duplicate public title is absent from findings, a preview differs from emitted metadata, or a non-administrator reads protected findings.
Mechanism: seo-operations
Status: Agreed 2026-10-10

[SEO-010] Each eligible public listing and article may expose a Markdown version linked from its HTML page. The version contains only the current public revision, is nonindexable by default, and loses access immediately when the source becomes ineligible.
Falsifier: A draft or suspended record has a Markdown response, a pending revision leaks into the Markdown body, an HTML page advertises a missing Markdown version, or a Markdown response lacks its content type, noindex or no-store headers.
Mechanism: seo-operations
Status: Agreed 2026-10-10
