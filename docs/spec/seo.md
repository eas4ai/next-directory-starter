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
