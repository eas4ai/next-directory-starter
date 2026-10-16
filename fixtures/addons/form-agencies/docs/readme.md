# FORM Agencies Directory

FORM is a complete agencies and studios directory for Next Directory Starter 1.2 or later. It combines a portfolio-first public composition, a versioned studio profile, an original geometric mark, and fourteen original art-directed case-study images.

## Install

```sh
npm run addon:validate -- ./form-agencies.zip
npm run addon:install -- ./form-agencies.zip
npm run db:migrate
npm run build
```

Activate `form-agencies.studios@1.0.0` in `/admin/profiles`, then preview and select FORM in `/admin/theme`. Sample data is explicit and optional:

```sh
npm run addon:seed -- form-agencies
```

The seed adds fourteen fictional studios, including one draft, and is safe to repeat. Install and removal do not implicitly open the database or change catalog data.

## Product behavior

- Portfolio imagery leads each tile while service, industry, location, team size, budget, model, availability, and lead time remain adjacent and readable.
- Search, filters, sorting, and pagination use ordinary server-rendered GET requests.
- Case-study titles, sectors, outcomes, links, and media are attributed to each listed studio. FORM does not claim client approval or independent performance verification.
- Inquiry links open the studio’s public contact page and do not claim acceptance or response.

Removing FORM restores unchanged package source and preserves explicitly seeded listings and media. The selected design safely falls back to the starter defaults.
