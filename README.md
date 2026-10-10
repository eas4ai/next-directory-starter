# Next Directory Starter

A Next.js starter for a curated directory of links, with articles, submissions, moderation, branding, search metadata, and optional paid placement. Listings point visitors to resources on other sites. Operators choose the subject, content, categories, and site identity.

## What you can build

The built-in listing fields are **name, summary, description, category, destination URL, slug, and publication status**. Articles add a title, summary, body, category, and tags. These examples use those fields and the workflows below:

| Site idea | How this starter fits |
| --- | --- |
| Developer tool directory | Curate tools by category, link to each project's site, and publish articles about the collection. |
| Community resource hub | Let members propose links, review submissions, and explain the resources in articles. |
| Partner or vendor guide | Publish profiles with outbound URLs and optionally offer time-limited featured placement. |
| Open-source project index | Group projects by category, add editorial updates, and accept reviewed suggestions. |
| Reading and research library | Organize source links by topic and publish articles with an RSS feed. |

## Features

### Public discovery

Visitors can search published listings by name, summary, or description, filter by category, and page through results. Each listing has a detail page and a link to its destination. Eligible paid placements can appear in a featured section, subject to the selected billing mode and current publication state. See [listing search and eligibility](src/lib/listings.ts) and the [public listing page](src/app/listings/page.tsx).

### Owner submissions

Account holders can save a private listing draft, submit it for review, and propose changes to an approved listing. The public version stays in place until a reviewer approves the proposal. Owners cannot edit another owner's listing. See the [owner publication workflow](src/lib/moderation.ts) and [owner workspace](src/app/owner/listings/page.tsx).

### Editorial publishing

Editors can draft articles, save revisions, preview them privately, and publish them. The public article index supports text search, categories, tags, and pagination; published articles appear in the RSS feed. Listing descriptions and article bodies render Markdown. See [article publication](src/lib/articles.ts), the [article index](src/app/articles/page.tsx), and the [feed route](src/app/feed.xml/route.ts).

### Listing and article images

Owners can upload an image for a listing, and article editors can upload an image for an article. Uploads remain private drafts until the listing submission is approved or the article revision is published. A public image is served only while its listing or article is published. See [image assignments and public eligibility](src/lib/media.ts), [listing approval](src/lib/moderation.ts), and [article publication](src/lib/articles.ts).

### Identity and staff access

Better Auth handles accounts with email verification, password recovery, and sign-in links for verified existing accounts. Administrators can assign separate moderation, article, catalog, taxonomy, and billing capabilities and suspend accounts. Access checks protect the corresponding workspaces and API routes. See [authentication](src/lib/auth.ts), [staff capabilities](src/lib/staff-roles.ts), and [account management](src/lib/accounts.ts). Public registration and account email flows require a configured Resend sender.

### Branding and themes

An administrator can set the site name, description, logo, icon, and default social image. The theme editor can save a shadcn/ui preset and choose a registered custom theme plus a classic or editorial layout. Visitors can choose light or dark appearance. The custom theme SDK defines validated color, typography, spacing, width, and social-card tokens. See [site configuration](src/lib/site-config.ts), [theme selection](src/lib/theme-selection.ts), and the [theme SDK](src/lib/theme-sdk.ts).

### Search and sharing

Public pages emit canonical URLs and per-page metadata. The app publishes a sitemap, article RSS feed, same-site redirects, and a missing-path report. Eligible listing and article pages expose their current public content as Markdown through explicit routes and through detail-page content negotiation for recognized agents or `Accept: text/markdown`. Public home, index, and detail pages advertise matching Open Graph and X images backed by 1200 × 630 PNG cards. The SEO workspace has publication-aware previews and findings. See [metadata](src/lib/page-metadata.ts), [social cards](src/lib/social-cards.ts), [Markdown negotiation](src/proxy.ts), and [SEO findings](src/lib/seo-findings.ts).

### Agent-assisted imports

An authenticated remote MCP endpoint lets a catalog agent list categories, stage observed links with source evidence, attach a validated screenshot, preview a card, and explicitly publish a reviewed import. Authorized catalog staff can also open `/admin/import` in a supported browser to expose WebMCP tools for the same import workflow. Staged links stay private until publication; duplicate destinations and repeated requests are handled before insertion. See the [remote MCP tools](src/app/api/mcp/route.ts), [browser WebMCP registration](src/app/admin/import/import-workspace.tsx), [import workflow](src/lib/agent-imports.ts), and [agent key management](src/lib/agent-keys.ts).

### Optional billing

Operators can define free, one-time, monthly, and annual publication plans in test or live mode. Eligible paid plans use provider-hosted checkout with Stripe or Paddle; NOWPayments supports one-time invoices. Signed provider events, rather than a browser return, determine paid periods and featured eligibility. Owners can inspect purchases and request supported recurring cancellations. Paid checkout needs provider credentials; saved provider profiles also need a persistent encryption key. See [plans](src/lib/plans.ts), [hosted checkout](src/lib/payment-provider.ts), and [payment effects](src/lib/payment-lifecycle.ts).

### Operations

Content, settings, accounts, and billing state live in SQLite; uploaded media lives in a writable directory. The repository includes migration and seed scripts, a provisioner for the first administrator, delivery of queued owner notices through Resend, billing reconciliation, and verified backup and isolated restore scripts. Production storage must persist across builds and restarts. See the [database connection](src/lib/database.ts), [catalog migration](src/lib/catalog-migrations.ts), [notification delivery](src/lib/notification-delivery.ts), and [backup script](scripts/backup.mjs).

## Technology

The application uses Next.js App Router, React, TypeScript, shadcn/ui components, Better Auth, SQLite through `better-sqlite3`, and Sharp for images. The exact installed versions and provider SDKs are in [package.json](package.json) and [package-lock.json](package-lock.json).

## Quick start

From a fresh clone, install dependencies, create a local environment file, migrate and seed SQLite, provision an administrator, then start the development server:

```sh
npm ci
cp .env.example .env.local
npm run db:migrate
npm run db:seed
npm run account:provision -- --email you@example.com --name "Site administrator"
npm run dev
```

Set a unique `BETTER_AUTH_SECRET` in `.env.local` before creating accounts. Set `BETTER_AUTH_URL` and `SITE_URL` to the origin where you open the app; the example file uses `http://localhost:3000`. The provisioner prompts for a password. Open `/admin/sign-in` for the administrator workspace and `/listings` for the seeded directory. The seed command is repeatable and keeps existing listings. See [database initialization](src/lib/catalog-migrations.ts) and [public URL validation](src/lib/page-metadata.ts).

Use `npm run build` and `npm run start` for a production build. Configure a persistent SQLite file and media directory before deployment. Public account email, billing providers, and owner-notification email depend on their respective external services; they are optional to the basic browsable directory.

## Manual

The [operator manual](docs/operator-manual.md) gives step-by-step instructions for installation, staff workflows, themes, SEO, agent imports, billing providers, scheduled jobs, backup, restore, and upgrades. The [source-linked manual brief](docs/manual-brief.md) records the topics and verification work used to prepare it.

## License

MIT licensed; see [LICENSE](LICENSE) and [third-party notices](NOTICE.md).
