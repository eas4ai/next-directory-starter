# Directory

Prefix: DIR

[DIR-001] The application shows eligible listings with their titles, summaries, and categories on a public directory index.
Falsifier: An eligible sample listing is absent from the index, or an unpublished listing appears there.
Mechanism: public-directory
Status: Agreed 2026-10-09

[DIR-002] The application serves a public detail page for each eligible listing with its title, description, category, and external destination.
Falsifier: An eligible sample listing has no reachable detail page, or its page omits its external destination.
Mechanism: public-directory
Status: Agreed 2026-10-09

[DIR-003] The application filters directory results by query and category and bounds the number shown on each page.
Falsifier: A category filter shows a listing outside that category, or one results page exceeds the documented page bound.
Mechanism: directory-search
Status: Agreed 2026-10-09

[DIR-004] The application removes ineligible listings from every public directory route when their publication state changes.
Falsifier: A suspended listing remains reachable at its former detail URL or appears in a directory result.
Mechanism: directory-eligibility
Status: Agreed 2026-10-09

[DIR-005] The application renders usable public directory pages at 320-pixel width and in light and dark themes.
Falsifier: A directory or detail page needs horizontal scrolling at 320 pixels, or its content is unreadable in either theme.
Mechanism: directory-design
Status: Agreed 2026-10-09
